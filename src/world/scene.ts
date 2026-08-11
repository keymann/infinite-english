import * as THREE from 'three';
import type { Theme } from './theme';

/**
 * 씬의 분위기 — 하늘·안개·조명.
 *
 * 조명은 HemisphereLight + DirectionalLight 두 개뿐이다. Kenney 에셋은 색이 이미
 * 아틀라스에 구워져 있어 조명을 늘려도 얻는 게 없고, 모바일에서는 라이트 하나가
 * 셰이더 분기 비용이다.
 *
 * 테마가 바뀔 때 색을 **즉시 바꾸지 않고 1.2초에 걸쳐 옮긴다.** 계단 모델은 경계에서
 * 딱 바뀌는 게 좋지만(다음 세계가 위에 보인다), 하늘이 한 프레임에 바뀌면 화면이 튄다.
 */

/** 색 전환 속도(1/초) — 지수 감쇠 */
const MOOD_LERP = 2.4;

export class Mood {
  readonly scene = new THREE.Scene();
  private readonly hemi: THREE.HemisphereLight;
  private readonly sun: THREE.DirectionalLight;
  private readonly fog: THREE.FogExp2;

  private readonly targetSky = new THREE.Color();
  private readonly targetHemiSky = new THREE.Color();
  private readonly targetHemiGround = new THREE.Color();
  private readonly targetSun = new THREE.Color();
  private targetFog = 0.03;
  private targetHemiIntensity = 2;
  private targetSunIntensity = 1.5;

  constructor(theme: Theme) {
    this.hemi = new THREE.HemisphereLight(theme.hemiSky, theme.hemiGround, theme.hemiIntensity);
    this.scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(theme.sunColor, theme.sunIntensity);
    this.sun.position.set(3, 7, 4);
    this.scene.add(this.sun);

    this.fog = new THREE.FogExp2(theme.sky, theme.fogDensity);
    this.scene.fog = this.fog;
    this.scene.background = new THREE.Color(theme.sky);

    this.applyTheme(theme, true);
  }

  applyTheme(theme: Theme, instant = false) {
    this.targetSky.set(theme.sky);
    this.targetHemiSky.set(theme.hemiSky);
    this.targetHemiGround.set(theme.hemiGround);
    this.targetSun.set(theme.sunColor);
    this.targetFog = theme.fogDensity;
    this.targetHemiIntensity = theme.hemiIntensity;
    this.targetSunIntensity = theme.sunIntensity;

    if (instant) {
      (this.scene.background as THREE.Color).copy(this.targetSky);
      this.fog.color.copy(this.targetSky);
      this.hemi.color.copy(this.targetHemiSky);
      this.hemi.groundColor.copy(this.targetHemiGround);
      this.sun.color.copy(this.targetSun);
      this.fog.density = this.targetFog;
      this.hemi.intensity = this.targetHemiIntensity;
      this.sun.intensity = this.targetSunIntensity;
    }
  }

  update(dt: number) {
    const t = 1 - Math.exp(-MOOD_LERP * dt);
    const sky = this.scene.background as THREE.Color;
    sky.lerp(this.targetSky, t);
    this.fog.color.copy(sky);
    this.hemi.color.lerp(this.targetHemiSky, t);
    this.hemi.groundColor.lerp(this.targetHemiGround, t);
    this.sun.color.lerp(this.targetSun, t);
    this.fog.density += (this.targetFog - this.fog.density) * t;
    this.hemi.intensity += (this.targetHemiIntensity - this.hemi.intensity) * t;
    this.sun.intensity += (this.targetSunIntensity - this.sun.intensity) * t;
  }
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
