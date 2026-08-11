import * as THREE from 'three';
import { STEP } from '../game/balance';
import { InstancedModel } from '../three/instanced';
import type { Stairs } from './stairs';

/**
 * 계단 양옆 배경 — **떠 있는 섬** 위의 나무·바위.
 *
 * 계단이 공중에 뜬 구조물이라 지면이 없다. 나무를 그냥 옆에 두면 허공에 떠서
 * 즉시 "버그로 보인다". 그래서 프롭마다 작은 블록(섬)을 함께 깔아
 * 떠 있는 것이 **의도된 세계관**으로 읽히게 한다.
 *
 * 계단과 같은 방식으로 보이는 구간만 인스턴스 슬롯에 그리고, 배치는 계단 번호로
 * 결정론적으로 계산한다 — 회수·재배치할 때 나무가 순간이동하면 즉시 눈에 띈다.
 */

/** 몇 칸마다 프롭을 놓을지 */
const SPACING = 3;
/** 계단 중심에서 좌우로 떨어뜨리는 거리 — 시야와 진행 경로를 가리지 않을 만큼 멀리 */
const SIDE_MIN = 3.4;
const SIDE_MAX = 6.6;
/** 좌우 한쪽에 섬이 생길 확률 (밀도 1 기준). 높이면 화면이 산만해진다 */
const CHANCE = 0.34;

/** 정수 → [0,1) 결정론적 해시 (계단 번호만으로 같은 배치를 재현한다) */
function hash01(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export class Props {
  readonly group = new THREE.Group();
  private readonly kinds: InstancedModel[] = [];
  private readonly island: InstancedModel;
  /** 섬 블록의 상단면 높이 — 프롭을 이 위에 올린다 */
  private readonly islandTop: number;
  private readonly matrix = new THREE.Matrix4();
  private readonly pos = new THREE.Vector3();
  private readonly quat = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  private readonly density: number;
  private readonly slots: number;

  constructor(
    sources: readonly THREE.Object3D[],
    islandSource: THREE.Object3D,
    density: number,
  ) {
    this.density = density;
    this.slots = Math.ceil(((STEP.ahead + STEP.behind) / SPACING) * 2) + 4;
    for (const source of sources) {
      const model = new InstancedModel(source, this.slots);
      this.kinds.push(model);
      this.group.add(model.group);
    }
    this.island = new InstancedModel(islandSource, this.slots);
    this.islandTop = this.island.bbox.max.y;
    this.group.add(this.island.group);
  }

  refresh(currentIndex: number, stairs: Stairs) {
    const counts = new Array(this.kinds.length).fill(0) as number[];
    let islands = 0;
    const from = Math.max(0, currentIndex - STEP.behind);
    const to = currentIndex + STEP.ahead;
    const up = new THREE.Vector3(0, 1, 0);

    for (let i = from; i <= to; i++) {
      if (i % SPACING !== 0) continue;

      // 좌우 각각 독립 판정 — 한쪽만 나오는 구간이 생겨 리듬이 단조롭지 않다
      for (const side of [-1, 1] as const) {
        const seed = i * 2 + (side > 0 ? 1 : 0);
        if (hash01(seed) > this.density * CHANCE) continue;

        // 앞쪽 종류(나무)에 가중치를 준다 — 섬 위에 풀 한 포기만 있으면 우스꽝스럽다
        const biased = Math.pow(hash01(seed * 31 + 7), 1.7);
        const kind = Math.min(this.kinds.length - 1, Math.floor(biased * this.kinds.length));
        const model = this.kinds[kind];
        const slot = counts[kind];
        if (slot >= model.capacity || islands >= this.island.capacity) continue;

        stairs.surfaceAt(i, this.pos);
        const away = SIDE_MIN + hash01(seed * 17 + 3) * (SIDE_MAX - SIDE_MIN);
        this.pos.x += side * away;
        // 계단 표면보다 아래에 섬을 띄운다 — 시야와 다음 계단을 가리지 않는다
        this.pos.y -= 1.1 + hash01(seed * 13 + 5) * 2.4;
        this.pos.z += (hash01(seed * 7 + 11) - 0.5) * STEP.z * 2;

        // 섬 (프롭을 받치는 블록)
        const islandScale = 0.8 + hash01(seed * 41 + 13) * 0.5;
        this.quat.setFromAxisAngle(up, hash01(seed * 19 + 4) * Math.PI * 2);
        this.scale.set(islandScale, 0.5 + hash01(seed * 29 + 6) * 0.5, islandScale);
        this.matrix.compose(this.pos, this.quat, this.scale);
        this.island.setAt(islands++, this.matrix);

        // 프롭 — 섬 상단면 위에 세운다
        this.pos.y += this.islandTop * this.scale.y;
        this.quat.setFromAxisAngle(up, hash01(seed * 5 + 2) * Math.PI * 2);
        const s = 0.85 + hash01(seed * 23 + 9) * 0.5;
        this.scale.setScalar(s);
        this.matrix.compose(this.pos, this.quat, this.scale);
        model.setAt(slot, this.matrix);
        counts[kind] = slot + 1;
      }
    }

    this.kinds.forEach((model, i) => {
      model.setCount(counts[i]);
      model.commit();
    });
    this.island.setCount(islands);
    this.island.commit();
  }
}
