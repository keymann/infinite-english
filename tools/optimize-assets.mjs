/**
 * 3D 에셋 파이프라인 — `npm run assets`
 *
 * 원본 kit 폴더(168MB)에서 tools/asset-manifest.json 에 적힌 모델만 골라
 * bundle 단위로 하나의 glb 로 병합해 public/models/ 에 쓴다.
 *
 * 병합하는 이유:
 *   1. **HTTP 요청 수** — 45개 모델을 개별 로드하면 45요청이다. 교실 와이파이에서 이게 곧
 *      "안 켜지는 게임"이 된다. bundle 단위면 5요청이다.
 *   2. **머티리얼·텍스처 공유** — Kenney kit 의 glb 는 전부 같은 `colormap` 아틀라스를
 *      가리킨다. 병합 후 dedup 하면 머티리얼 1개·텍스처 1장으로 합쳐지고,
 *      런타임 셰이더 프로그램도 하나만 컴파일된다(draw call 배칭에 유리).
 *   3. 정점 accessor 중복 제거.
 *
 * 산출물은 커밋한다 — 빌드 재현성 + CI 에 이 스크립트 의존성을 넣지 않기 위해.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { NodeIO, Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, mergeDocuments } from '@gltf-transform/functions';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'public', 'models');
const MANIFEST = join(ROOT, 'tools', 'asset-manifest.json');

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

const kb = (n) => `${(n / 1024).toFixed(0)}KB`;

/**
 * 애니메이션 전용 bundle 의 **리그 통합**.
 *
 * 애니메이션 파일 2개를 그냥 병합하면 똑같은 리그가 2벌 들어온다. glTF 는 노드 이름 중복을
 * 허용하지만 three 의 GLTFLoader 는 중복 이름에 `_1` 을 붙여 유일화한다. 그러면 두 번째
 * 파일에서 온 클립의 트랙 이름이 `hips_1` 이 되고, 캐릭터의 본은 `hips` 이므로
 * **AnimationMixer 가 아무것도 움직이지 않는다** — 경고만 남기고 조용히 실패한다.
 * (스파이크 A 1차 실행에서 실제로 이 증상이 나왔다: 69건의 PropertyBinding 경고)
 *
 * 그래서 첫 리그를 정본으로 두고 모든 애니메이션 채널을 이름으로 재바인딩한 뒤,
 * 중복 리그를 삭제한다.
 */
function mergeRigs(doc, scene) {
  const wrappers = scene.listChildren();
  if (wrappers.length <= 1) return;

  const collect = (node, out = []) => {
    out.push(node);
    for (const c of node.listChildren()) collect(c, out);
    return out;
  };

  const canonical = new Map();
  for (const node of collect(wrappers[0])) {
    if (!canonical.has(node.getName())) canonical.set(node.getName(), node);
  }

  let rebound = 0;
  for (const anim of doc.getRoot().listAnimations()) {
    for (const ch of anim.listChannels()) {
      const target = ch.getTargetNode();
      if (!target) continue;
      const canon = canonical.get(target.getName());
      if (canon && canon !== target) {
        ch.setTargetNode(canon);
        rebound++;
      }
    }
  }

  const doomed = wrappers.slice(1).flatMap((w) => collect(w));
  for (const node of doomed) node.dispose();

  console.log(
    `  리그 통합: 채널 ${rebound}개 재바인딩, 중복 노드 ${doomed.length}개 삭제 → 리그 1벌`,
  );
}

/**
 * bundle 하나를 만든다.
 * 각 원본 모델의 씬 루트를 `<모델명>` 이라는 래퍼 노드로 감싸 하나의 씬에 모은다.
 * 런타임은 이 이름으로 서브트리를 찾는다 — assets.get('tree_default').
 */
async function buildBundle(bundle) {
  const srcDir = join(ROOT, bundle.dir);
  const doc = new Document();
  const scene = doc.createScene(bundle.name);
  doc.getRoot().setDefaultScene(scene);

  const missing = [];
  const skinned = [];
  let srcBytes = 0;

  for (const name of bundle.models) {
    const path = join(srcDir, `${name}.glb`);
    if (!existsSync(path)) {
      missing.push(name);
      continue;
    }
    srcBytes += statSync(path).size;

    const src = await io.read(path);
    if (src.getRoot().listSkins().length > 0) skinned.push(name);
    const before = new Set(doc.getRoot().listScenes());
    mergeDocuments(doc, src);

    // merge 는 원본의 씬을 그대로 들여온다. 새로 들어온 씬의 자식들을 래퍼로 옮기고
    // 빈 씬은 버린다. (씬이 여러 개 남으면 three 는 첫 씬만 그린다)
    const added = doc.getRoot().listScenes().filter((s) => !before.has(s));
    const wrapper = doc.createNode(name);
    for (const s of added) {
      for (const child of s.listChildren()) wrapper.addChild(child);
      s.dispose();
    }
    scene.addChild(wrapper);
  }

  if (missing.length) {
    throw new Error(
      `[${bundle.name}] 원본에 없는 모델: ${missing.join(', ')}\n  경로 확인: ${srcDir}`,
    );
  }

  /* 스킨드 캐릭터는 bundle 하나에 하나만 넣는다.
     같은 리그를 쓰는 캐릭터 2개를 한 glb 에 합치면 본 이름(hips, hand.r …)이 중복되고,
     three 의 GLTFLoader 가 뒤에 오는 쪽에 `_1` 을 붙여 유일화한다. 그러면
     공유 애니메이션 클립의 트랙 이름과 본 이름이 어긋나 **경고만 남기고 조용히 안 움직인다.**
     (스파이크 A 2차 실행에서 Skeleton_Minion 이 이 증상으로 실패했다)
     프롭(스킨 없음)은 이름 충돌이 애니메이션에 영향을 주지 않으므로 얼마든 병합해도 된다. */
  if (!bundle.animationsOnly && skinned.length > 1) {
    throw new Error(
      `[${bundle.name}] 스킨드 캐릭터가 ${skinned.length}개다: ${skinned.join(', ')}\n` +
        `  본 이름이 중복되면 three 가 _1 을 붙여 애니메이션 바인딩이 조용히 깨진다.\n` +
        `  캐릭터는 bundle 을 하나씩 분리할 것 (asset-manifest.json).`,
    );
  }

  // 애니메이션 전용 bundle — 리그와 클립만 남기고 메시·머티리얼을 버린다.
  if (bundle.animationsOnly) {
    for (const skin of doc.getRoot().listSkins()) skin.dispose();
    for (const mesh of doc.getRoot().listMeshes()) mesh.dispose();
    for (const mat of doc.getRoot().listMaterials()) mat.dispose();
    for (const tex of doc.getRoot().listTextures()) tex.dispose();
    mergeRigs(doc, scene);
  }

  await doc.transform(
    dedup(),
    // keepLeaves: true — 본(bone)은 메시가 없는 리프 노드다. 기본값으로 돌리면
    // 애니메이션 타겟인 본이 지워져 클립이 조용히 아무것도 움직이지 않게 된다.
    prune({ keepLeaves: true }),
  );

  // 병합하면 원본마다 버퍼가 하나씩 따라온다. GLB 는 버퍼가 0~1개여야 하므로
  // 모든 accessor 를 첫 버퍼로 모으고 나머지를 버린다.
  const buffers = doc.getRoot().listBuffers();
  if (buffers.length > 1) {
    const [main, ...rest] = buffers;
    for (const accessor of doc.getRoot().listAccessors()) accessor.setBuffer(main);
    for (const b of rest) b.dispose();
  }

  const glb = await io.writeBinary(doc);
  mkdirSync(OUT_DIR, { recursive: true });
  const outPath = join(OUT_DIR, `${bundle.name}.glb`);
  writeFileSync(outPath, glb);

  const root = doc.getRoot();
  return {
    name: bundle.name,
    when: bundle.when,
    file: `models/${bundle.name}.glb`,
    nodes: scene.listChildren().map((n) => n.getName()),
    counts: {
      meshes: root.listMeshes().length,
      materials: root.listMaterials().length,
      textures: root.listTextures().length,
      animations: root.listAnimations().length,
      skins: root.listSkins().length,
    },
    srcBytes,
    bytes: glb.byteLength,
    gzip: gzipSync(glb).byteLength,
  };
}

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const results = [];
for (const bundle of manifest.bundles) results.push(await buildBundle(bundle));

writeFileSync(
  join(OUT_DIR, 'manifest.json'),
  JSON.stringify(
    { bundles: results.map(({ srcBytes: _s, ...r }) => r) },
    null,
    2,
  ) + '\n',
);

/* ── 리포트 ── */
const pad = (s, n) => String(s).padEnd(n);
console.log(
  pad('bundle', 15),
  pad('로드', 6),
  pad('원본', 9),
  pad('산출', 9),
  pad('gzip', 9),
  pad('모델', 5),
  pad('메시', 5),
  pad('머티', 5),
  pad('텍스', 5),
  pad('애니', 5),
);
console.log('-'.repeat(90));
for (const r of results) {
  console.log(
    pad(r.name, 15),
    pad(r.when, 6),
    pad(kb(r.srcBytes), 9),
    pad(kb(r.bytes), 9),
    pad(kb(r.gzip), 9),
    pad(r.nodes.length, 5),
    pad(r.counts.meshes, 5),
    pad(r.counts.materials, 5),
    pad(r.counts.textures, 5),
    pad(r.counts.animations, 5),
  );
}

const sum = (f) => results.reduce((a, r) => a + f(r), 0);
const eager = results.filter((r) => r.when === 'eager');
const eagerGzip = eager.reduce((a, r) => a + r.gzip, 0);

console.log('-'.repeat(90));
console.log(`전체        : ${kb(sum((r) => r.bytes))} (gzip ${kb(sum((r) => r.gzip))})`);
console.log(
  `첫 로드(eager): ${kb(eager.reduce((a, r) => a + r.bytes, 0))} (gzip ${kb(eagerGzip)}) — ${eager.map((r) => r.name).join(', ')}`,
);

// 예산: 첫 로드 3MB (docs/영어계단-작업계획.md 2장)
const BUDGET = 3 * 1024 * 1024;
const ok = eagerGzip <= BUDGET;
console.log(`예산 3MB     : ${ok ? '통과' : '초과'} (첫 로드 gzip ${kb(eagerGzip)})`);
if (!ok) process.exitCode = 1;
