import * as THREE from 'three';
import { SHOP_ITEMS, type ShopItem } from '../src/progress/shop';
import { Actor, RIG_MEDIUM_VOCAB } from '../src/three/actor';
import { Assets } from '../src/three/assets';

/**
 * 상점 썸네일 굽기 — `npm run dev` 후 http://localhost:5173/tools/thumbs.html
 *
 * 상점 목록은 이모지로 시작했다. 🗡️ 하나로 낡은 검·기사의 검·용사의 검을 구별할 수 없어
 * "무엇을 사는지" 가 보이지 않았다. 실제 3D 모델을 한 번 그려 PNG 가 아닌 **webp 파일로 굽는다.**
 *
 * 런타임에 그리지 않는 이유: 상점을 열 때마다 캐릭터 번들 6개(gzip 약 1.1MB)를 받아야 한다.
 * 구워 두면 썸네일 하나가 수 KB 다.
 *
 * 결과는 dev 서버의 `/__thumbs` 로 보내 `public/thumbs/<id>.webp` 에 쓴다 (vite.config.ts).
 * 이 페이지는 빌드에 들어가지 않는다.
 */

const SIZE = 192;

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(SIZE, SIZE);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor(0x000000, 0);

const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight(0xffffff, 0x445066, 2.2));
const sun = new THREE.DirectionalLight(0xffffff, 2.4);
sun.position.set(2, 4, 3);
scene.add(sun);
const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 100);

const assets = new Assets('front');
const status = document.querySelector<HTMLElement>('#status')!;
const grid = document.querySelector<HTMLElement>('#grid')!;

/** 모델을 화면 가운데에 꽉 차게 놓는다 — 크기가 제각각이라 bbox 로 맞춘다 */
function frame(object: THREE.Object3D, pitch: number) {
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  const center = box.getCenter(new THREE.Vector3());
  const radius = box.getSize(new THREE.Vector3()).length() / 2;
  const dist = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 0.92;
  camera.position.set(center.x, center.y + dist * Math.sin(pitch), center.z + dist * Math.cos(pitch));
  camera.lookAt(center);
  camera.updateProjectionMatrix();
}

/** 상점 항목 하나를 씬에 세운다 */
function stage(item: ShopItem): THREE.Object3D {
  if (item.category === 'character') {
    // 상점 캐릭터는 애니메이션이 없다 — boss-anims 의 대기 자세 한 프레임을 입힌다(T 포즈 방지)
    const actor = new Actor(assets.instance(item.asset, item.id), assets.clips('boss-anims'), 1, RIG_MEDIUM_VOCAB);
    actor.playRole('idle', { fade: 0 });
    actor.update(0.4);
    actor.root.rotation.y = -0.45;
    return actor.root;
  }
  const bundle = item.category === 'weapon' ? 'weapons' : 'items';
  const root = new THREE.Group();
  const model = assets.instance(bundle, item.asset);
  root.add(model);
  if (item.extra) root.add(assets.instance(bundle, item.extra));
  // 무기는 손잡이가 원점이고 날이 +y 다 — 비스듬히 눕혀야 실루엣이 산다
  // 활은 납작해서 같은 각도면 옆면만 보인다 — 시위가 보이게 정면으로 돌린다
  if (item.asset.startsWith('bow')) root.rotation.set(0, Math.PI / 2, -Math.PI / 4);
  else if (item.category === 'weapon') root.rotation.set(0, 0.5, -Math.PI / 4);
  else root.rotation.y = -0.5;
  return root;
}

async function bake(item: ShopItem) {
  const object = stage(item);
  scene.add(object);
  frame(object, item.category === 'character' ? 0.12 : 0.35);
  renderer.render(scene, camera);
  scene.remove(object);

  const blob = await new Promise<Blob>((resolve, reject) =>
    renderer.domElement.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob 실패'))), 'image/webp', 0.9),
  );
  const res = await fetch(`/__thumbs?id=${encodeURIComponent(item.id)}`, { method: 'POST', body: blob });
  if (!res.ok) throw new Error(`${item.id}: 저장 실패 ${res.status}`);

  grid.insertAdjacentHTML(
    'beforeend',
    `<figure><img src="${URL.createObjectURL(blob)}" alt="" /><figcaption>${item.name} · ${(blob.size / 1024).toFixed(1)}KB</figcaption></figure>`,
  );
}

async function main() {
  const characters = SHOP_ITEMS.filter((i) => i.category === 'character').map((i) => i.asset);
  await assets.load(['weapons', 'items', 'boss-anims', ...characters]);
  let done = 0;
  for (const item of SHOP_ITEMS) {
    await bake(item);
    status.textContent = `${++done} / ${SHOP_ITEMS.length}`;
  }
  status.textContent = `완료 — ${done}개 (public/thumbs/)`;
  document.body.dataset.done = String(done);
}

main().catch((err: unknown) => {
  status.textContent = `실패: ${String(err)}`;
  document.body.dataset.error = String(err);
});
