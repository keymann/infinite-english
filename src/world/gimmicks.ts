import * as THREE from 'three';
import { CHECKPOINT_EVERY, STEP } from '../game/balance';
import { InstancedModel } from '../three/instanced';
import type { Stairs } from './stairs';

/**
 * 계단 기믹 — 발판 위에 놓이는 상호작용 요소.
 *
 * 규칙은 하나다: **어떤 기믹도 HP 를 깎지 않는다.** HP 는 영어 오답 전용이고,
 * 기믹은 보상·정보·리듬만 건드린다 (기획서 3.2절).
 *
 * | 기믹 | 하는 일 |
 * |---|---|
 * | 크리스탈 | 그 칸에 착지하면 골드를 준다 |
 * | 체크포인트 깃발 | 10층마다 서 있어 "얼마나 왔는지"를 눈으로 보여 준다 |
 * | 스프링 | 착지하면 한 칸을 공짜로 더 오른다 |
 *
 * 방향 안내는 3D 표지판을 세워 봤지만 이 시점에서는 읽히지 않았다 —
 * 지금은 **다음 칸을 밝게 그리는 것**으로 대신한다 (stairs.setHint).
 *
 * 배치는 **계단 번호의 해시**로 정한다. 회수·재배치해도 같은 칸에 같은 것이 온다.
 */

export type GimmickKind = 'crystal' | 'spring' | null;

/** 크리스탈이 놓일 확률 */
const CRYSTAL_CHANCE = 0.16;
/** 스프링이 놓일 확률 (크리스탈보다 드물게 — 특별해야 한다) */
const SPRING_CHANCE = 0.05;
/** 처음 몇 칸은 아무것도 두지 않는다 — 조작을 익히는 구간 */
const QUIET_FLOORS = 2;

/** 원본 모델 크기가 kit 마다 달라 배치 시 맞춰 줄인다 */
const SCALE = { crystal: 1.1, spring: 0.42, flag: 0.16 } as const;

function hash01(n: number, salt: number): number {
  let h = Math.imul((n + salt * 7919) ^ 0x6d2b79f5, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export type GimmickSources = {
  crystal: THREE.Object3D;
  spring: THREE.Object3D;
  flag: THREE.Object3D;
};

export class Gimmicks {
  readonly group = new THREE.Group();

  private readonly crystal: InstancedModel;
  private readonly spring: InstancedModel;
  private readonly flag: InstancedModel;
  /** 이미 먹은 크리스탈 — 다시 그리지 않는다 */
  private readonly taken = new Set<number>();
  private readonly matrix = new THREE.Matrix4();
  private readonly pos = new THREE.Vector3();
  private readonly quat = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private spin = 0;

  constructor(sources: GimmickSources) {
    const capacity = STEP.ahead + STEP.behind + 2;
    this.crystal = new InstancedModel(sources.crystal, capacity);
    this.spring = new InstancedModel(sources.spring, capacity);
    this.flag = new InstancedModel(sources.flag, capacity);
    for (const m of [this.crystal, this.spring, this.flag]) this.group.add(m.group);
  }

  /** 이 칸에 무엇이 있는지 — 게임이 착지 시 확인한다 */
  kindAt(index: number): GimmickKind {
    if (index <= QUIET_FLOORS) return null;
    if (this.taken.has(index)) return null;
    // 스프링을 먼저 본다. 한 칸에 둘을 놓지 않는다
    if (hash01(index, 3) < SPRING_CHANCE) return 'spring';
    if (hash01(index, 1) < CRYSTAL_CHANCE) return 'crystal';
    return null;
  }

  /** 크리스탈을 먹었다 */
  take(index: number) {
    this.taken.add(index);
    // 화면 밖으로 나간 기록은 버린다 — 5,000층을 오르면 Set 이 무한히 커진다
    for (const key of this.taken) {
      if (key < index - STEP.behind - 8) this.taken.delete(key);
    }
  }

  reset() {
    this.taken.clear();
  }

  /** 크리스탈이 천천히 돈다 — 정지한 물체는 "먹을 수 있는 것"으로 안 보인다 */
  update(dt: number) {
    this.spin += dt * 1.6;
  }

  refresh(currentIndex: number, stairs: Stairs) {
    const from = Math.max(0, currentIndex - STEP.behind);
    const to = from + STEP.ahead + STEP.behind + 1;

    let crystals = 0;
    let springs = 0;
    let flags = 0;

    for (let i = from; i <= to; i++) {
      stairs.surfaceAt(i, this.pos);
      const kind = this.kindAt(i);

      if (kind === 'crystal' && crystals < this.crystal.capacity) {
        this.place(this.crystal, crystals++, this.pos, SCALE.crystal, this.spin, 0.05);
      } else if (kind === 'spring' && springs < this.spring.capacity) {
        this.place(this.spring, springs++, this.pos, SCALE.spring, 0, 0);
      }

      // 체크포인트 깃발
      if (i > 0 && i % CHECKPOINT_EVERY === 0 && flags < this.flag.capacity) {
        this.pos.x += 0.42;
        this.place(this.flag, flags++, this.pos, SCALE.flag, 0, 0);
        this.pos.x -= 0.42;
      }
    }

    this.crystal.setCount(crystals);
    this.spring.setCount(springs);
    this.flag.setCount(flags);
    for (const m of [this.crystal, this.spring, this.flag]) m.commit();
  }

  private place(
    model: InstancedModel,
    slot: number,
    at: THREE.Vector3,
    scale: number,
    spin: number,
    lift: number,
  ) {
    this.quat.setFromAxisAngle(this.up, spin);
    this.scale.setScalar(scale);
    this.pos.set(at.x, at.y + lift, at.z);
    this.matrix.compose(this.pos, this.quat, this.scale);
    model.setAt(slot, this.matrix);
  }
}
