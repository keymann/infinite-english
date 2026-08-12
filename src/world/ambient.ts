import * as THREE from 'three';
import { STEP } from '../game/balance';
import { InstancedModel } from '../three/instanced';

/**
 * 떠다니는 UFO — 눈·하늘 월드의 배경 생명체.
 *
 * 게임 규칙에 관여하지 않는다. 배경이 **가만히 있으면 죽은 세계처럼 보인다** —
 * 움직이는 것이 하나 있으면 같은 모델로도 살아 있는 느낌이 난다.
 *
 * 스킨이 없는 모델이라 InstancedMesh 로 그린다. 3종 × 3마리를 사인 곡선으로 흔들고
 * 플레이어를 기준으로 위치를 잡아 계속 시야에 남긴다.
 */

/** 종류마다 몇 마리 */
const PER_KIND = 3;
/** 플레이어 기준 배치 반경 */
const SPREAD_X = 9;
const SPREAD_Y = 6;
const SPREAD_Z = 12;

export class Ambient {
  readonly group = new THREE.Group();
  private readonly kinds: InstancedModel[] = [];
  private readonly matrix = new THREE.Matrix4();
  private readonly pos = new THREE.Vector3();
  private readonly quat = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private time = 0;
  private enabled = false;

  constructor(sources: readonly THREE.Object3D[]) {
    for (const source of sources) {
      const model = new InstancedModel(source, PER_KIND);
      model.setCount(0);
      this.kinds.push(model);
      this.group.add(model.group);
    }
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    if (!on) for (const model of this.kinds) model.setCount(0);
  }

  update(dt: number, playerPos: THREE.Vector3) {
    if (!this.enabled || this.kinds.length === 0) return;
    this.time += dt;

    this.kinds.forEach((model, kind) => {
      for (let i = 0; i < PER_KIND; i++) {
        const seed = kind * 3 + i;
        const t = this.time * (0.16 + seed * 0.035) + seed * 2.1;
        // 플레이어를 중심으로 궤도를 돈다 — 계단이 올라가도 계속 시야에 남는다
        this.pos.set(
          playerPos.x + Math.sin(t) * SPREAD_X + (seed % 2 ? 2 : -2),
          playerPos.y + SPREAD_Y * 0.5 + Math.sin(t * 1.7) * (SPREAD_Y * 0.35) + seed * 0.6,
          playerPos.z - SPREAD_Z * 0.4 + Math.cos(t * 0.8) * SPREAD_Z * 0.35,
        );
        this.quat.setFromAxisAngle(this.up, t * 0.7);
        this.scale.setScalar(0.55 + (seed % 3) * 0.12);
        this.matrix.compose(this.pos, this.quat, this.scale);
        model.setAt(i, this.matrix);
      }
      model.setCount(PER_KIND);
      model.commit();
    });
  }

  /** 계단 한 칸 높이를 기준으로 한 배치 높이 — 디버그용 */
  static get spread(): number {
    return SPREAD_Y * STEP.y;
  }
}
