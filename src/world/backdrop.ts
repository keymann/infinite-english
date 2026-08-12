import * as THREE from 'three';
import { CAMERA } from '../game/balance';
import type { BackdropSpec, Theme } from './theme';

/**
 * 배경 — 하늘 · 해/달 · 별 · 구름 · 원경 실루엣 · 날씨.
 *
 * **텍스처를 새로 만들지 않는다.** 그라디언트 하늘은 셰이더 두 색으로, 원경은 절차적 도형으로,
 * 날씨는 파티클로 만든다. 아트 파이프라인 없이 6개 월드의 분위기를 다르게 만드는 방법이다.
 *
 * 배경 전체가 draw call 7~8개다:
 *   하늘 1 · 해/달 1 · 별 1 · 구름 1 · 원경 1(+폭포 1) · 날씨 1 · 횃불 1
 *
 * 모든 요소는 **플레이어를 따라 움직인다.** 계단이 무한히 올라가므로 고정해 두면 금방
 * 화면에서 사라진다 — 하늘과 원경은 원래 "따라오는 것"이라 어색하지 않다.
 */

/** 하늘 돔 반지름 — 카메라 far(200) 안이어야 한다 */
const SKY_RADIUS = 150;
/**
 * 원경 실루엣 거리.
 *
 * 해/달(0.55R)보다 **멀리** 두어야 한다. 처음에 78 로 두니 거대한 도형이 해와 구름을 가려
 * 하늘이 추상 무늬처럼 보였다.
 */
const DISTANT_RADIUS = 122;
/** 날씨 파티클이 뿌려지는 범위 */
const WEATHER_SPAN = 26;

/**
 * 배경을 **카메라 시야각 기준으로** 배치한다.
 *
 * 이 게임의 카메라는 계단을 내려다본다 — 플레이어 기준 (0, 5.2, 9.4) 에서 (0, 1, 0) 을 보므로
 * 약 **24° 아래**를 향하고, 세로 시야 42° 를 감안하면 화면에 들어오는 것은 눈높이보다
 * **3°~45° 아래**다. 처음에 해·구름·산을 "하늘"이라 생각해 눈높이 위에 뒀더니 전부 화면
 * 밖으로 나갔다(스크린샷에서 아무것도 안 보였다). 여기서는 각도를 직접 지정한다.
 */
const CAM_PITCH_TOP = 4;
const CAM_PITCH_BOTTOM = 42;

/** 시야 안의 방향(아래로 pitch 도, 정면 기준 azimuth 도)에 거리 d 로 놓는다 */
function skyPosition(out: THREE.Vector3, azimuthDeg: number, pitchDownDeg: number, dist: number) {
  const az = (azimuthDeg * Math.PI) / 180;
  const pitch = (pitchDownDeg * Math.PI) / 180;
  // 카메라 높이에서 아래로 pitch 만큼 내려간 지점 (플레이어 원점 기준)
  return out.set(
    Math.sin(az) * dist,
    CAMERA.offset.y - Math.tan(pitch) * dist,
    -Math.cos(az) * dist + CAMERA.offset.z,
  );
}

const SKY_VERT = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/** 위·아래 두 색을 섞는다. `offset` 으로 지평선 위치를 조절한다 */
const SKY_FRAG = /* glsl */ `
  uniform vec3 topColor;
  uniform vec3 bottomColor;
  uniform float offset;
  uniform vec3 origin;
  varying vec3 vWorld;
  void main() {
    float h = normalize(vWorld - origin).y;
    float t = clamp((h + offset) / (1.0 + offset), 0.0, 1.0);
    gl_FragColor = vec4(mix(bottomColor, topColor, pow(t, 0.85)), 1.0);
  }
`;

type Weather = {
  points: THREE.Points;
  velocity: Float32Array;
  kind: 'leaf' | 'snow' | 'none';
};

export class Backdrop {
  readonly group = new THREE.Group();

  private readonly sky: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private readonly celestial: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  private readonly stars: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private readonly clouds: THREE.InstancedMesh;
  private readonly torches: THREE.InstancedMesh;
  private readonly distant = new Map<string, THREE.InstancedMesh>();
  private readonly waterfall: THREE.InstancedMesh;
  private weather: Weather;

  private spec: BackdropSpec | null = null;
  private readonly matrix = new THREE.Matrix4();
  private readonly pos = new THREE.Vector3();
  private readonly quat = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private time = 0;
  /** 구간 진행도 — 석양이 낮아지는 연출 */
  private progress = 0;

  constructor() {
    /* ── 그라디언트 하늘 ── */
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(SKY_RADIUS, 24, 12),
      new THREE.ShaderMaterial({
        vertexShader: SKY_VERT,
        fragmentShader: SKY_FRAG,
        uniforms: {
          topColor: { value: new THREE.Color(0x3f9fe0) },
          bottomColor: { value: new THREE.Color(0xd6f0ff) },
          offset: { value: 0.35 },
          origin: { value: new THREE.Vector3() },
        },
        side: THREE.BackSide,
        depthWrite: false,
        // 하늘에 안개가 끼면 색이 뭉개진다 — 안개는 원경까지만
        fog: false,
      }),
    );
    this.sky.renderOrder = -100;
    this.group.add(this.sky);

    /* ── 해 / 달 ── */
    this.celestial = new THREE.Mesh(
      new THREE.CircleGeometry(1, 32),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, fog: false }),
    );
    this.celestial.renderOrder = -99;
    this.group.add(this.celestial);

    /* ── 별 ── */
    this.stars = new THREE.Points(
      new THREE.BufferGeometry(),
      new THREE.PointsMaterial({
        color: 0xffffff,
        size: 0.9,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.9,
        fog: false,
      }),
    );
    this.stars.renderOrder = -98;
    this.stars.visible = false;
    this.group.add(this.stars);

    /* ── 구름 — 납작한 상자를 겹쳐 뭉치처럼 보이게 한다 ── */
    this.clouds = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 0.3, 0.7),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, fog: false }),
      18,
    );
    this.clouds.count = 0;
    this.clouds.frustumCulled = false;
    this.group.add(this.clouds);

    /* ── 원경 실루엣 — 종류마다 도형이 다르다 ── */
    const shapes: Record<string, THREE.BufferGeometry> = {
      // 산 능선 — 완만한 원뿔
      mountain: new THREE.ConeGeometry(1, 1.5, 5, 1),
      // 성탑 — 사각 기둥 + 뾰족한 지붕은 원뿔 하나로 대신한다
      tower: new THREE.CylinderGeometry(0.55, 0.75, 2.6, 6, 1),
      // 빙하 — 날카로운 삼각뿔
      glacier: new THREE.ConeGeometry(0.8, 2.4, 4, 1),
      // 떠 있는 바위 — 아래가 뾰족한 팔면체
      rock: new THREE.OctahedronGeometry(1, 0),
    };
    for (const [kind, geometry] of Object.entries(shapes)) {
      /* MeshBasicMaterial — 조명을 받지 않는다. Lambert 로 두면 밝은 반구광에 씻겨
         실루엣이 아니라 밝은 덩어리가 된다(노을 테마에서 연어색으로 떠 보였다). */
      const mesh = new THREE.InstancedMesh(
        geometry,
        new THREE.MeshBasicMaterial({ color: 0x556677, fog: false }),
        20,
      );
      mesh.count = 0;
      mesh.frustumCulled = false;
      this.distant.set(kind, mesh);
      this.group.add(mesh);
    }

    /* ── 폭포 (하늘섬) — 얇은 반투명 판이 아래로 흐른다 ── */
    this.waterfall = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        color: 0xdff6ff,
        transparent: true,
        opacity: 0.42,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
      12,
    );
    this.waterfall.count = 0;
    this.waterfall.frustumCulled = false;
    this.group.add(this.waterfall);

    /* ── 횃불 (성) — 작은 발광 원판 ── */
    this.torches = new THREE.InstancedMesh(
      new THREE.CircleGeometry(0.16, 8),
      new THREE.MeshBasicMaterial({
        color: 0xffb04a,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      }),
      14,
    );
    this.torches.count = 0;
    this.torches.frustumCulled = false;
    this.group.add(this.torches);

    this.weather = this.makeWeather('none', 0, 0xffffff);
  }

  private makeWeather(kind: 'leaf' | 'snow' | 'none', count: number, color: number): Weather {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(Math.max(1, count) * 3);
    const velocity = new Float32Array(Math.max(1, count) * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * WEATHER_SPAN;
      positions[i * 3 + 1] = Math.random() * WEATHER_SPAN;
      positions[i * 3 + 2] = (Math.random() - 0.5) * WEATHER_SPAN;
      // 낙엽은 좌우로 크게 흔들리고, 눈은 강풍에 한쪽으로 밀린다
      velocity[i * 3] = kind === 'leaf' ? (Math.random() - 0.5) * 1.4 : -1.6 - Math.random();
      velocity[i * 3 + 1] = kind === 'leaf' ? -0.9 - Math.random() * 0.5 : -2.2 - Math.random();
      velocity[i * 3 + 2] = (Math.random() - 0.5) * 0.7;
    }
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const points = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        color,
        size: kind === 'leaf' ? 0.22 : 0.16,
        transparent: true,
        opacity: kind === 'leaf' ? 0.95 : 0.85,
        fog: false,
      }),
    );
    points.visible = count > 0;
    points.frustumCulled = false;
    return { points, velocity, kind };
  }

  applyTheme(theme: Theme) {
    const spec = theme.backdrop;
    this.spec = spec;

    const uniforms = this.sky.material.uniforms;
    (uniforms.topColor.value as THREE.Color).set(spec.skyTop);
    (uniforms.bottomColor.value as THREE.Color).set(spec.skyBottom);

    // 해/달
    this.celestial.visible = !!spec.celestial;
    if (spec.celestial) {
      this.celestial.material.color.set(spec.celestial.color);
      this.celestial.scale.setScalar(spec.celestial.size);
    }

    // 별 — 개수가 바뀌면 다시 만든다
    if (spec.stars > 0) {
      const positions = new Float32Array(spec.stars * 3);
      const at = new THREE.Vector3();
      for (let i = 0; i < spec.stars; i++) {
        // 카메라 시야 띠(정면 ±110°, 아래 4~34°)에 뿌린다 — 밖에 뿌리면 보이지 않는다
        skyPosition(
          at,
          -110 + Math.random() * 220,
          CAM_PITCH_TOP + Math.random() * 30,
          SKY_RADIUS * 0.86,
        );
        positions[i * 3] = at.x;
        positions[i * 3 + 1] = at.y;
        positions[i * 3 + 2] = at.z;
      }
      this.stars.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      this.stars.visible = true;
    } else {
      this.stars.visible = false;
    }

    // 구름
    this.clouds.material = new THREE.MeshBasicMaterial({
      color: spec.clouds.color,
      transparent: true,
      opacity: spec.clouds.opacity,
      fog: false,
    });
    this.clouds.count = Math.min(spec.clouds.count, this.clouds.instanceMatrix.count);

    // 원경 — 이번 테마의 종류만 켠다
    for (const [kind, mesh] of this.distant) {
      if (kind === spec.distant.kind) {
        (mesh.material as THREE.MeshBasicMaterial).color.set(spec.distant.color);
        // 겹쳐서 능선이 되도록 넉넉히 세운다
        mesh.count = Math.min(spec.distant.count, mesh.instanceMatrix.count);
        this.layoutDistant(mesh, spec.distant.kind, spec.distant.scale);
      } else {
        mesh.count = 0;
      }
    }
    // 폭포는 떠 있는 바위(하늘섬)에만
    this.waterfall.count = spec.distant.kind === 'rock' ? 8 : 0;

    this.torches.count = spec.torches ? this.torches.instanceMatrix.count : 0;

    // 날씨 — 종류가 바뀌면 파티클을 다시 만든다
    if (this.weather.kind !== spec.weather.kind) {
      this.group.remove(this.weather.points);
      this.weather.points.geometry.dispose();
      this.weather = this.makeWeather(spec.weather.kind, spec.weather.count, spec.weather.color);
      this.group.add(this.weather.points);
    } else {
      (this.weather.points.material as THREE.PointsMaterial).color.set(spec.weather.color);
    }
  }

  /**
   * 원경을 플레이어 주위 원형으로 배치한다 (한 번만 — 매 프레임 다시 깔 이유가 없다).
   *
   * 크기를 **눈에 보이는 각도로** 잡는다. 처음에 "size" 하나로 대충 곱했더니 폭 45·높이 67
   * 짜리 도형이 122 거리에 서서 화면의 30° 를 덮었다 — 산이 아니라 추상 무늬가 됐다.
   * 먼 능선은 지평선 위로 5~10° 만 올라온다.
   */
  private layoutDistant(mesh: THREE.InstancedMesh, kind: string, scaleBase: number) {
    // [폭, 높이, 밑동 y] — 밑동을 지평선 아래로 내려 봉우리만 보이게 한다
    /* 산은 **완만하고 넓다**(w > h). 처음에 h/w 를 2.4 로 뒀더니 삼각 깃발처럼 보였다.
       빙하·성탑은 반대로 뾰족한 게 맞다. */
    const shape = {
      mountain: { w: 26, h: 15, vary: 8 },
      tower: { w: 7, h: 34, vary: 4 },
      glacier: { w: 15, h: 22, vary: 5 },
      // 떠 있는 바위는 **거대해야** 한다 — 작으면 파편처럼 보인다 (하늘섬에서 확인)
      rock: { w: 11, h: 9, vary: 5 },
    }[kind] ?? { w: 20, h: 16, vary: 5 };

    for (let i = 0; i < mesh.count; i++) {
      /* 정면 ±95° 안에 몰아 배치한다 — 뒤쪽은 카메라가 절대 보지 않으므로
         원 전체에 흩으면 화면에 한두 개만 걸려 능선이 안 된다 */
      const azimuth = -95 + (i / Math.max(1, mesh.count - 1)) * 190;
      const radius = DISTANT_RADIUS * (0.92 + ((i * 37) % 24) / 100);
      const jitter = ((i * 17) % 100) / 100;
      const w = (shape.w + jitter * shape.vary) * scaleBase;
      const h = (shape.h + jitter * shape.vary * 2) * scaleBase;
      // 능선은 시야 아래쪽(pitch 20~28°)에 얹고, 떠 있는 바위는 위쪽에 흩는다
      const pitch = kind === 'rock' ? 7 + ((i * 13) % 14) : 21 + ((i * 7) % 7);

      skyPosition(this.pos, azimuth, pitch, radius);
      /* 밑동을 화면 밖까지 내려 보낸다 — 공중에 뜬 삼각형이 아니라 지평선에서 솟은
         능선으로 보이게 하려면 아래가 잘려 있어야 한다 */
      if (kind !== 'rock') this.pos.y -= h * 0.72;
      this.quat.setFromAxisAngle(this.up, (azimuth * Math.PI) / 180);
      /* 원본 지오메트리는 반지름 1 · 높이 1.5(원뿔) 기준이다.
         폭 w = 2 * 반지름스케일 → 반지름스케일 = w/2 */
      const geoHeight = kind === 'tower' ? 2.6 : kind === 'rock' ? 2 : kind === 'glacier' ? 2.4 : 1.5;
      this.scale.set(w / 2, h / geoHeight, w / 2);
      this.matrix.compose(this.pos, this.quat, this.scale);
      mesh.setMatrixAt(i, this.matrix);

      if (this.waterfall.count > 0 && i < this.waterfall.count) {
        // 떠 있는 바위 아래로 떨어지는 폭포 — 구름 속으로 사라지듯 길게
        this.pos.y -= h * 0.5;
        this.scale.set(w * 0.3, h * 4, 1);
        this.matrix.compose(this.pos, this.quat, this.scale);
        this.waterfall.setMatrixAt(i, this.matrix);
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    this.waterfall.instanceMatrix.needsUpdate = true;
  }

  /** @param progress 구간 진행도 0~1 — 석양이 낮아진다 */
  update(dt: number, playerPos: THREE.Vector3, progress: number) {
    this.time += dt;
    this.progress = progress;
    const spec = this.spec;
    if (!spec) return;

    // 하늘·별·원경은 플레이어를 따라온다
    this.group.position.set(playerPos.x, playerPos.y, playerPos.z);
    (this.sky.material.uniforms.origin.value as THREE.Vector3).set(0, 0, 0);

    /* 해/달 — 시야 안에 들어오는 pitch 로 놓는다.
       height 1 = 시야 위쪽, 0 = 시야 아래쪽. 석양(height 낮음)은 화면에서 낮게 걸린다.
       원경 실루엣(DISTANT_RADIUS)보다 앞에 둬야 가려지지 않는다. */
    if (spec.celestial) {
      const height = Math.max(0.04, spec.celestial.height - spec.celestial.drop * this.progress);
      const pitch = CAM_PITCH_TOP + (1 - height) * (CAM_PITCH_BOTTOM - CAM_PITCH_TOP) * 0.5;
      skyPosition(this.celestial.position, 16, pitch, SKY_RADIUS * 0.62);
      this.celestial.lookAt(
        this.group.position.x,
        this.group.position.y + CAMERA.offset.y,
        this.group.position.z + CAMERA.offset.z,
      );
    }

    // 구름 — 시야 위쪽 띠에서 천천히 흐른다
    for (let i = 0; i < this.clouds.count; i++) {
      const drift = ((this.time * (1.4 + (i % 3) * 0.6) + i * 24) % 150) - 75;
      const dist = 62 + ((i * 17) % 34);
      const pitch = CAM_PITCH_TOP + 1.5 + ((i * 11) % 12);
      skyPosition(this.pos, drift * 0.55, pitch, dist);
      this.quat.identity();
      const w = 9 + ((i * 5) % 12);
      this.scale.set(w, 2.4 + (i % 3), w * 0.7);
      this.matrix.compose(this.pos, this.quat, this.scale);
      this.clouds.setMatrixAt(i, this.matrix);
    }
    if (this.clouds.count > 0) this.clouds.instanceMatrix.needsUpdate = true;

    /* 횃불 — **먼 성벽의 불빛**이다. 계단 옆 공중에 두면 근거 없는 주황 점으로 보였다.
       원경 실루엣(성탑) 쪽에 붙여 거리감을 준다. */
    for (let i = 0; i < this.torches.count; i++) {
      const azimuth = -80 + (i / Math.max(1, this.torches.count - 1)) * 160;
      const dist = DISTANT_RADIUS * (0.55 + ((i * 23) % 30) / 100);
      const pitch = 19 + ((i * 13) % 8);
      const flicker = 0.7 + Math.sin(this.time * (5 + i * 0.7) + i) * 0.3;
      skyPosition(this.pos, azimuth, pitch, dist);
      this.quat.identity();
      // 먼 불빛이므로 거리에 비례해 크게 — 화면에서는 작은 점으로 보인다
      this.scale.setScalar(flicker * dist * 0.06);
      this.matrix.compose(this.pos, this.quat, this.scale);
      this.torches.setMatrixAt(i, this.matrix);
    }
    if (this.torches.count > 0) this.torches.instanceMatrix.needsUpdate = true;

    // 날씨 — 아래로 흐르고, 범위를 벗어나면 위로 되돌린다
    const weather = this.weather;
    if (weather.kind !== 'none') {
      const attr = weather.points.geometry.getAttribute('position') as THREE.BufferAttribute;
      const array = attr.array as Float32Array;
      for (let i = 0; i < array.length / 3; i++) {
        const k = i * 3;
        const sway = weather.kind === 'leaf' ? Math.sin(this.time * 1.7 + i) * 0.9 : 0;
        array[k] += (weather.velocity[k] + sway) * dt;
        array[k + 1] += weather.velocity[k + 1] * dt;
        array[k + 2] += weather.velocity[k + 2] * dt;
        if (array[k + 1] < -WEATHER_SPAN * 0.4) {
          array[k] = (Math.random() - 0.5) * WEATHER_SPAN;
          array[k + 1] = WEATHER_SPAN * 0.6;
          array[k + 2] = (Math.random() - 0.5) * WEATHER_SPAN;
        }
      }
      attr.needsUpdate = true;
    }
  }
}
