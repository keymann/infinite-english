import * as THREE from 'three';

/**
 * 월드 1 — Word Forest 의 조명·대기.
 *
 * 조명은 HemisphereLight + DirectionalLight 두 개뿐이다. Kenney 에셋은 색이 이미
 * 아틀라스에 구워져 있어 조명을 늘려도 얻는 게 없고, 모바일에서는 라이트 하나가
 * 셰이더 분기 비용이다.
 */
export function createForestScene(): THREE.Scene {
  const scene = new THREE.Scene();
  const sky = new THREE.Color(0x8fd3ff);
  scene.background = sky;
  // 생성 구간의 끝이 허공에서 잘려 보이지 않게 안개로 덮는다
  scene.fog = new THREE.FogExp2(sky.getHex(), 0.028);

  const hemi = new THREE.HemisphereLight(0xd8ecff, 0x3f5a2a, 2.1);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff2d0, 1.5);
  sun.position.set(3, 7, 4);
  scene.add(sun);

  return scene;
}

/**
 * 캐릭터 발밑 그림자.
 *
 * 실시간 shadowMap 을 쓰지 않는 이유: 계단이 매 프레임 바뀌어 그림자 맵을 계속 다시
 * 그려야 하고, 저사양 태블릿에서 그 비용이 프레임 예산을 다 먹는다. 발밑에 원형
 * 그라디언트 한 장을 깔면 "공중에 떠 있지 않다"는 정보는 충분히 전달된다.
 * 텍스처는 파일로 두지 않고 캔버스로 만든다 — 요청 0개, 바이트 0.
 */
export function createBlobShadow(radius: number): THREE.Mesh {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(0,0,0,0.55)');
  grad.addColorStop(0.6, 'rgba(0,0,0,0.22)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(radius * 2, radius * 2),
    new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      // 계단 표면과 같은 높이에 놓이므로 z-fighting 을 피한다
      polygonOffset: true,
      polygonOffsetFactor: -1,
    }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.renderOrder = 1;
  // 점프 중에는 착지할 계단 위에 그림자가 놓여 "어디에 내릴지"를 알려 준다
  mesh.frustumCulled = false;
  return mesh;
}
