import * as THREE from 'three';
import type { FxKind } from '../game/weaponPerk';

/**
 * 타격 연출 — 정답으로 보스를 때린 순간, 무기 계열에 맞는 효과를 보스 위치에 터뜨린다.
 *
 * 보스 HP 바가 줄어드는 것만으로는 "내 무기가 이렇게 때렸다" 가 남지 않는다.
 * 계열마다 모양을 다르게 해 무기를 바꾼 의미가 화면에서 보이게 한다.
 *
 * | 모양 | 계열 |
 * |---|---|
 * | 베기 호(arc) | 검 |
 * | 불꽃 튀김 | 도끼 |
 * | 바닥 충격파 | 망치 |
 * | 번개 불똥 | 단검 |
 * | 날아가는 빛 → 튀김 | 활(화살) · 창(찌르기) · 지팡이(마법탄) |
 * | 별 튀김 | 너클 · 맨손 |
 *
 * **오브젝트를 새로 만들지 않는다.** 입자·고리·탄 하나씩을 미리 만들어 재사용한다 —
 * 정답마다 지오메트리를 만들면 보스전 한 번에 수십 개가 쌓인다. 정답 간격(1초 이상)보다
 * 연출이 짧아서(0.6초) 하나로 충분하다. 쓰지 않을 때는 숨겨 draw call 을 쓰지 않는다.
 */

const PARTICLES = 36;
/** 튀김 지속 시간(초) */
const BURST_SEC = 0.55;
/** 탄이 날아가는 시간(초) */
const FLY_SEC = 0.16;

type Shape = { burst: 'sparks' | 'stars' | 'none'; ring: 'none' | 'arc' | 'floor'; projectile: boolean; gravity: number };

const SHAPES: Record<FxKind, Shape> = {
  slash: { burst: 'sparks', ring: 'arc', projectile: false, gravity: 0 },
  fire: { burst: 'sparks', ring: 'none', projectile: false, gravity: -2.5 },
  quake: { burst: 'stars', ring: 'floor', projectile: false, gravity: 6 },
  spark: { burst: 'sparks', ring: 'none', projectile: false, gravity: 0 },
  arrow: { burst: 'sparks', ring: 'none', projectile: true, gravity: 3 },
  thrust: { burst: 'sparks', ring: 'arc', projectile: true, gravity: 0 },
  magic: { burst: 'stars', ring: 'none', projectile: true, gravity: -1.2 },
  star: { burst: 'stars', ring: 'none', projectile: false, gravity: 4 },
};

/**
 * 입자 하나의 모양 — 가운데가 밝은 원. 텍스처 없이 그리면 PointsMaterial 은 **네모**를 그려
 * 빛이 아니라 픽셀 조각으로 보인다. 32px 캔버스 하나를 만들어 모든 입자가 공유한다.
 */
function glowTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.85)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class HitFx {
  readonly group = new THREE.Group();

  private readonly points: THREE.Points;
  private readonly positions: Float32Array;
  private readonly velocities = new Float32Array(PARTICLES * 3);
  private readonly pointMat: THREE.PointsMaterial;
  private readonly ring: THREE.Mesh;
  private readonly ringMat: THREE.MeshBasicMaterial;
  private readonly bolt: THREE.Mesh;
  private readonly boltMat: THREE.MeshBasicMaterial;

  private readonly from = new THREE.Vector3();
  private readonly to = new THREE.Vector3();
  private shape: Shape = SHAPES.star;
  private scale = 1;
  /** 0 이상이면 재생 중. 탄이 있으면 날아가는 시간이 앞에 붙는다 */
  private t = -1;
  private burstAt = 0;
  private burstStarted = false;

  constructor() {
    const geo = new THREE.BufferGeometry();
    this.positions = new Float32Array(PARTICLES * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.pointMat = new THREE.PointsMaterial({
      map: glowTexture(),
      size: 0.16,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    this.points = new THREE.Points(geo, this.pointMat);
    this.points.frustumCulled = false;

    this.ringMat = new THREE.MeshBasicMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.72, 40, 1, 0, Math.PI * 2), this.ringMat);

    this.boltMat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.bolt = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), this.boltMat);

    this.group.add(this.points, this.ring, this.bolt);
    this.hide();
  }

  /** 재생 중인지 */
  get active(): boolean {
    return this.t >= 0;
  }

  /**
   * 터뜨린다.
   *
   * @param from 플레이어 손 높이 — 탄이 여기서 출발한다
   * @param to   보스 몸통 높이 — 효과가 여기서 터진다
   * @param big  특기가 발동했는지. 크고 많이 튄다
   */
  play(kind: FxKind, color: number, from: THREE.Vector3, to: THREE.Vector3, big: boolean) {
    this.shape = SHAPES[kind];
    this.scale = big ? 1.6 : 1;
    this.from.copy(from);
    this.to.copy(to);
    this.pointMat.color.setHex(color);
    this.ringMat.color.setHex(color);
    this.boltMat.color.setHex(color);
    // 세로 화면에서 보스까지 거리가 10 유닛 남짓이라 이보다 작으면 점으로 보인다
    this.pointMat.size = (this.shape.burst === 'stars' ? 0.34 : 0.24) * this.scale;

    this.t = 0;
    this.burstAt = this.shape.projectile ? FLY_SEC : 0;
    this.burstStarted = false;
    this.group.visible = true;
    this.points.visible = false;
    this.ring.visible = false;
    this.bolt.visible = this.shape.projectile;
    if (this.shape.projectile) this.bolt.position.copy(from);
  }

  private startBurst() {
    this.burstStarted = true;
    this.bolt.visible = false;

    if (this.shape.burst !== 'none') {
      this.points.visible = true;
      const speed = (this.shape.burst === 'stars' ? 1.6 : 2.6) * this.scale;
      for (let i = 0; i < PARTICLES; i++) {
        this.positions.set([this.to.x, this.to.y, this.to.z], i * 3);
        // 구면 위의 고른 방향 — 한쪽으로 쏠리면 "튀김" 이 아니라 "분사" 로 보인다
        const u = Math.random() * 2 - 1;
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(1 - u * u);
        const v = speed * (0.55 + Math.random() * 0.45);
        this.velocities.set([r * Math.cos(a) * v, Math.abs(u) * v * 0.9 + 0.4, r * Math.sin(a) * v], i * 3);
      }
      this.points.geometry.attributes.position.needsUpdate = true;
    }

    if (this.shape.ring !== 'none') {
      this.ring.visible = true;
      this.ring.position.copy(this.to);
      if (this.shape.ring === 'floor') {
        // 망치 — 보스 발밑에 눕힌 충격파
        this.ring.position.y -= 0.55;
        this.ring.rotation.set(-Math.PI / 2, 0, 0);
      } else {
        // 베기 — 카메라 쪽(+z)을 보며 비스듬히 선 호
        this.ring.rotation.set(0, 0, Math.PI / 5);
      }
      this.ring.scale.setScalar(0.4);
    }
  }

  update(dt: number) {
    if (this.t < 0) return;
    this.t += dt;

    if (!this.burstStarted) {
      if (this.t >= this.burstAt) this.startBurst();
      else this.bolt.position.lerpVectors(this.from, this.to, this.t / FLY_SEC);
      return;
    }

    const life = (this.t - this.burstAt) / BURST_SEC;
    if (life >= 1) {
      this.hide();
      return;
    }
    const fade = 1 - life;

    if (this.points.visible) {
      for (let i = 0; i < PARTICLES; i++) {
        const k = i * 3;
        this.velocities[k + 1] -= this.shape.gravity * dt;
        this.positions[k] += this.velocities[k] * dt;
        this.positions[k + 1] += this.velocities[k + 1] * dt;
        this.positions[k + 2] += this.velocities[k + 2] * dt;
      }
      this.points.geometry.attributes.position.needsUpdate = true;
      this.pointMat.opacity = fade;
    }
    if (this.ring.visible) {
      this.ring.scale.setScalar((0.4 + life * (this.shape.ring === 'floor' ? 2.6 : 1.4)) * this.scale);
      this.ringMat.opacity = fade * 0.9;
    }
  }

  hide() {
    this.t = -1;
    this.group.visible = false;
  }
}
