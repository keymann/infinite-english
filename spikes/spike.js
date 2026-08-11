/**
 * Phase 0 스파이크 A/B 검증 스크립트.
 *
 * A: Skeletons 캐릭터 glb 에는 애니메이션이 없다. 별도 파일(Rig_Medium_*)의 클립을
 *    AnimationMixer 로 붙였을 때 **캐릭터 본이 실제로 움직이는지**를 좌표로 확인한다.
 *    "클립이 로드됐다"까지만 보면 안 된다 — 이름이 안 맞으면 three 는 조용히 아무것도 안 한다.
 *
 * B: 병합 glb 가 로드되고, 래퍼 노드 이름으로 서브트리를 꺼낼 수 있고,
 *    렌더 비용(draw call·삼각형·fps)이 예산 안인지 확인한다.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/* 검증 실패를 놓치지 않기 위해 경고를 가로챈다.
   three 의 PropertyBinding 은 타겟 노드를 못 찾으면 warn 만 남기고 넘어간다. */
const warnings = [];
const origWarn = console.warn;
console.warn = (...args) => {
  warnings.push(args.join(' '));
  origWarn(...args);
};

const results = [];
const check = (group, name, ok, detail) => {
  results.push({ group, name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} [${group}] ${name} — ${detail}`);
};

const loader = new GLTFLoader();
const load = (file) =>
  new Promise((res, rej) => loader.load(`/models/${file}`, res, undefined, rej));

/* ── 씬 ── */
const wrap = document.getElementById('canvas-wrap');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(wrap.clientWidth, wrap.clientHeight);
wrap.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d1117);
scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x35301f, 2.2));
const sun = new THREE.DirectionalLight(0xfff3d6, 1.6);
sun.position.set(4, 8, 6);
scene.add(sun);

const camera = new THREE.PerspectiveCamera(38, wrap.clientWidth / wrap.clientHeight, 0.1, 100);
camera.position.set(4.6, 3.0, 6.2);
camera.lookAt(0, 0.9, 0);

/* ── 로드 ── */
const t0 = performance.now();
const [player, forest, food, warriorGltf, minionGltf, bossAnims] = await Promise.all([
  load('player.glb'),
  load('world-forest.glb'),
  load('food.glb'),
  load('boss-warrior.glb'),
  load('boss-minion.glb'),
  load('boss-anims.glb'),
]);
const loadMs = Math.round(performance.now() - t0);

const pick = (gltf, name) => gltf.scene.children.find((c) => c.name === name);

/**
 * three 는 노드 이름에서 `.` `:` `/` `[` `]` 를 지운다(PropertyBinding.sanitizeNodeName).
 * 원본 리그의 `hand.r` 은 씬에서 `handr` 이 된다 — 원본 이름으로 찾으면 못 찾는다.
 */
const sanitize = (n) => n.replace(/[\s]/g, '_').replace(/[[\].:/]/g, '');
const findBone = (root, rawName) => {
  const want = sanitize(rawName);
  let found = null;
  root.traverse((o) => {
    if (!found && o.isBone && o.name === want) found = o;
  });
  return found;
};

/* ── 스파이크 B: 병합 glb 조회 ── */
check('B', '병합 glb 6개 로드', true, `${loadMs}ms (dev 서버, 로컬)`);

const forestNames = forest.scene.children.map((c) => c.name);
check(
  'B',
  '이름으로 노드 조회 (world-forest)',
  forestNames.length === 19 && forestNames.includes('tree_default'),
  `${forestNames.length}개 — ${forestNames.slice(0, 4).join(', ')} …`,
);

const foodNames = food.scene.children.map((c) => c.name);
check(
  'B',
  'TYPE_C 그림 문제용 모델 (food)',
  foodNames.length === 25 && foodNames.includes('apple'),
  `${foodNames.length}개 — apple, banana, pizza …`,
);

/* 머티리얼이 실제로 공유되는지 — 셰이더 프로그램 수와 직결된다 */
const foodMats = new Set();
food.scene.traverse((o) => o.material && foodMats.add(o.material.uuid));
check('B', 'food 머티리얼 공유 (dedup 효과)', foodMats.size === 1, `머티리얼 ${foodMats.size}종 / 모델 25개`);

/* ── 씬 구성: 숲 프롭 + 플레이어 + 보스 ── */
const stepGeoSource = pick(forest, 'cliff_block_rock');
const tree = pick(forest, 'tree_default');
const apple = pick(food, 'apple');

// 계단 인스턴싱 예비 검증 — 병합 glb 에서 꺼낸 지오메트리로 InstancedMesh 가 만들어지는지
let stepMesh = null;
stepGeoSource?.traverse((o) => {
  if (o.isMesh && !stepMesh) stepMesh = o;
});
if (stepMesh) {
  const inst = new THREE.InstancedMesh(stepMesh.geometry, stepMesh.material, 24);
  const m = new THREE.Matrix4();
  for (let i = 0; i < 24; i++) {
    m.makeTranslation((i % 2 ? 1 : -1) * 0.55, i * 0.42 - 4, -i * 0.55);
    inst.setMatrixAt(i, m);
  }
  inst.instanceMatrix.needsUpdate = true;
  scene.add(inst);
  check('B', '계단 InstancedMesh 24칸', true, '병합 glb 의 지오메트리를 그대로 인스턴싱');
} else {
  check('B', '계단 InstancedMesh 24칸', false, 'cliff_block_rock 에서 메시를 찾지 못했다');
}

if (tree) {
  tree.position.set(-2.2, -1.2, -1.4);
  scene.add(tree);
}
if (apple) {
  apple.position.set(1.5, 1.1, 1.2);
  apple.scale.setScalar(2.5);
  scene.add(apple);
}

/* ── 플레이어: 자체 내장 애니메이션 ── */
const playerRoot = pick(player, 'character-male-a');
playerRoot.position.set(-0.55, 0.1, 0.2);
scene.add(playerRoot);

const playerMixer = new THREE.AnimationMixer(playerRoot);
const clipNames = player.animations.map((c) => c.name);
const wanted = ['idle', 'jump', 'die', 'emote-yes', 'emote-no'];
check(
  'B',
  '플레이어 내장 클립 (정답/오답/상승/사망 연출)',
  wanted.every((w) => clipNames.includes(w)),
  `${clipNames.length}종 중 ${wanted.join(' · ')} 확인`,
);
const idle = THREE.AnimationClip.findByName(player.animations, 'idle');
if (idle) playerMixer.clipAction(idle).play();

/* ── 스파이크 A: 다른 파일의 클립을 보스 캐릭터에 적용 ── */
const warrior = pick(warriorGltf, 'Skeleton_Warrior');
warrior.position.set(1.5, 0.1, -0.6);
warrior.rotation.y = -0.5;
scene.add(warrior);

const bossClips = bossAnims.animations;
check(
  'A',
  '애니메이션 전용 glb 클립 수',
  bossClips.length === 26,
  `${bossClips.length}종 — ${bossClips
    .slice(0, 6)
    .map((c) => c.name)
    .join(', ')} …`,
);

/* 본 이름 교집합 — 클립의 트랙 이름이 캐릭터 본과 맞아야 바인딩된다 */
const warriorBones = new Set();
warrior.traverse((o) => {
  if (o.isBone) warriorBones.add(o.name);
});
const walk = THREE.AnimationClip.findByName(bossClips, 'Walking_A');
// 트랙 이름은 `<노드>.<속성>` 이고 노드 이름은 이미 sanitize 되어 있다
const trackTargets = new Set(walk.tracks.map((t) => t.name.replace(/\.(position|quaternion|scale)$/, '')));
const matched = [...trackTargets].filter((n) => warriorBones.has(n));
check(
  'A',
  '본 이름 일치 (클립 트랙 ↔ 캐릭터 리그)',
  matched.length === trackTargets.size && matched.length > 0,
  `${matched.length}/${trackTargets.size} 일치 · 캐릭터 본 ${warriorBones.size}개`,
);

/* 핵심 검증: 실제로 본이 움직이는가.
   손 본의 월드 좌표를 t=0 과 t=0.45s 에서 비교한다. */
const bossMixer = new THREE.AnimationMixer(warrior);
bossMixer.clipAction(walk).play();

const handBone = findBone(warrior, 'hand.r');
const sample = () => {
  warrior.updateMatrixWorld(true);
  return handBone.getWorldPosition(new THREE.Vector3());
};
bossMixer.update(0);
const p0 = sample();
bossMixer.update(0.45);
const p1 = sample();
const moved = p0.distanceTo(p1);
check(
  'A',
  '★ 본이 실제로 움직인다 (hand.r 월드 좌표 변화)',
  moved > 0.01,
  `0.45초 동안 ${moved.toFixed(3)} 유닛 이동`,
);

/* Minion 도 같은 리그를 쓰는지 — 보스 2종에 클립을 재사용할 수 있는가 */
const minion = pick(minionGltf, 'Skeleton_Minion');
minion.position.set(2.8, 0.1, 0.9);
minion.scale.setScalar(0.9);
scene.add(minion);
const minionMixer = new THREE.AnimationMixer(minion);
minionMixer.clipAction(THREE.AnimationClip.findByName(bossClips, 'Idle_A')).play();
const minionHand = findBone(minion, 'hand.r');
minionMixer.update(0);
minion.updateMatrixWorld(true);
const m0 = minionHand.getWorldPosition(new THREE.Vector3());
minionMixer.update(0.6);
minion.updateMatrixWorld(true);
const m1 = minionHand.getWorldPosition(new THREE.Vector3());
check(
  'A',
  '같은 클립을 다른 캐릭터에 재사용 (Minion)',
  m0.distanceTo(m1) > 0.001,
  `Idle_A 적용 후 ${m0.distanceTo(m1).toFixed(4)} 유닛 이동`,
);

check(
  'A',
  '바인딩 경고 없음',
  warnings.filter((w) => /PropertyBinding|no target node/i.test(w)).length === 0,
  `three 경고 ${warnings.length}건`,
);

/* ── 렌더 루프 + fps 측정 ── */
const clock = new THREE.Clock();
let frames = 0;
let elapsed = 0;
let peakCalls = 0;
let peakTris = 0;

function frame() {
  const dt = clock.getDelta();
  playerMixer.update(dt);
  bossMixer.update(dt);
  minionMixer.update(dt);
  if (apple) apple.rotation.y += dt * 1.2;
  renderer.render(scene, camera);

  peakCalls = Math.max(peakCalls, renderer.info.render.calls);
  peakTris = Math.max(peakTris, renderer.info.render.triangles);
  frames++;
  elapsed += dt;

  if (elapsed < 2.5) requestAnimationFrame(frame);
  else finish();
}

function finish() {
  const fps = Math.round(frames / elapsed);
  check('B', 'draw call', peakCalls <= 60, `${peakCalls}회 (예산 60)`);
  check('B', '삼각형', peakTris <= 150000, `${peakTris.toLocaleString()}개 (예산 150,000)`);
  check('B', 'fps (데스크톱)', fps >= 55, `${fps}fps · ${frames}프레임 / ${elapsed.toFixed(1)}초`);
  render();
}

function render() {
  const rows = results
    .map(
      (r) =>
        `<tr><td>${r.group}</td><td>${r.name}</td><td class="${r.ok ? 'pass' : 'fail'}">${
          r.ok ? 'PASS' : 'FAIL'
        }</td><td>${r.detail}</td></tr>`,
    )
    .join('');
  const failed = results.filter((r) => !r.ok);
  document.getElementById('report').innerHTML = `
    <div id="verdict" class="${failed.length ? 'fail' : 'pass'}">
      ${failed.length ? `FAIL ${failed.length}건 — ${failed.map((f) => f.name).join(', ')}` : `전체 통과 (${results.length}건)`}
    </div>
    <table><tr><th>스파이크</th><th>항목</th><th>결과</th><th>상세</th></tr>${rows}</table>
    <h2>참고 — 첫 로드 예산</h2>
    <div>player + world-forest = 372KB raw / 72KB gzip (예산 3MB) · 전체 7 bundle 2,324KB / 725KB gzip</div>
  `;
  console.log(`SPIKE_DONE failed=${failed.length} total=${results.length}`);
}

render();
frame();
