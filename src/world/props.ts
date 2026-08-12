import * as THREE from 'three';
import { STEP } from '../game/balance';
import { InstancedModel } from '../three/instanced';
import type { Stairs } from './stairs';
import { themeForFloor } from './theme';

/**
 * 계단 양옆 배경 — **떠 있는 섬** 위의 프롭.
 *
 * 계단이 공중에 뜬 구조물이라 지면이 없다. 나무를 그냥 옆에 두면 허공에 떠서
 * 즉시 "버그로 보인다". 그래서 프롭마다 작은 블록(섬)을 함께 깔아
 * 떠 있는 것이 **의도된 세계관**으로 읽히게 한다.
 *
 * 계단과 같은 방식으로 보이는 구간만 인스턴스 슬롯에 그리고, 배치는 계단 번호로
 * 결정론적으로 계산한다 — 회수·재배치할 때 나무가 순간이동하면 즉시 눈에 띈다.
 * 층 구간에 따라 모델 세트가 바뀌므로 세트별로 인스턴스를 따로 둔다.
 */

/** 몇 칸마다 프롭을 놓을지 */
const SPACING = 3;
/** 계단 중심에서 좌우로 떨어뜨리는 거리 — 시야와 진행 경로를 가리지 않을 만큼 멀리 */
const SIDE_MIN = 3.4;
const SIDE_MAX = 6.6;
/** 좌우 한쪽에 섬이 생길 확률 (밀도 1 기준). 높이면 화면이 산만해진다 */
const CHANCE = 0.34;

/**
 * 원경 레이어 — 가까운 섬보다 **멀고 낮고 크다.**
 *
 * 가까운 섬만 있으면 그 너머가 빈 하늘이라 세계가 얇아 보인다. 같은 모델을 크게 키워
 * 멀리 두면 깊이가 생긴다.
 *
 * **draw call 이 늘지 않는다.** 같은 `InstancedModel` 에 인스턴스를 더 담는 것뿐이다
 * (용량만 늘린다). 새 종류를 추가하는 것과 달리 재질이 늘지 않기 때문이다.
 */
const FAR = {
  spacing: 7,
  sideMin: 9,
  sideMax: 15.5,
  chance: 0.62,
  /** 아래로 내리는 거리 — 가까운 섬보다 훨씬 낮아야 시야를 막지 않는다 */
  dropMin: 4.5,
  dropMax: 10,
  scaleMin: 1.7,
  scaleMax: 2.9,
} as const;

/** 정수 → [0,1) 결정론적 해시 (계단 번호만으로 같은 배치를 재현한다) */
function hash01(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export type PropSet = {
  setId: string;
  props: THREE.Object3D[];
  island: THREE.Object3D;
};

type SetModels = {
  kinds: InstancedModel[];
  island: InstancedModel;
  islandTop: number;
};

export class Props {
  readonly group = new THREE.Group();
  private readonly sets = new Map<string, SetModels>();
  private defaultSetId = '';
  private readonly slots: number;
  private readonly density: number;
  private readonly matrix = new THREE.Matrix4();
  private readonly pos = new THREE.Vector3();
  private readonly quat = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);

  constructor(sets: readonly PropSet[], density: number) {
    this.density = density;
    const span = STEP.ahead + STEP.behind;
    // 가까운 레이어 + 원경 레이어를 한 인스턴스 풀에 담는다
    this.slots = Math.ceil((span / SPACING) * 2) + Math.ceil((span / FAR.spacing) * 2) + 6;
    for (const set of sets) this.addSet(set);
  }

  addSet(set: PropSet) {
    if (this.sets.has(set.setId)) return;
    const island = new InstancedModel(set.island, this.slots);
    const models: SetModels = {
      kinds: set.props.map((p) => new InstancedModel(p, this.slots)),
      island,
      islandTop: island.bbox.max.y,
    };
    for (const m of models.kinds) this.group.add(m.group);
    this.group.add(island.group);
    this.sets.set(set.setId, models);
    if (!this.defaultSetId) this.defaultSetId = set.setId;
  }

  refresh(currentIndex: number, stairs: Stairs) {
    const counts = new Map<string, { kinds: number[]; island: number }>();
    for (const [id, models] of this.sets) {
      counts.set(id, { kinds: models.kinds.map(() => 0), island: 0 });
    }

    const from = Math.max(0, currentIndex - STEP.behind);
    const to = currentIndex + STEP.ahead;

    for (let i = from; i <= to; i++) {
      if (i % SPACING !== 0) continue;
      const theme = themeForFloor(i);
      const setId = this.sets.has(theme.setId) ? theme.setId : this.defaultSetId;
      const models = this.sets.get(setId);
      const count = counts.get(setId);
      if (!models || !count) continue;

      // 좌우 각각 독립 판정 — 한쪽만 나오는 구간이 생겨 리듬이 단조롭지 않다
      for (const side of [-1, 1] as const) {
        const seed = i * 2 + (side > 0 ? 1 : 0);
        if (hash01(seed) > this.density * CHANCE) continue;

        // 앞쪽 종류에 가중치를 준다 — 섬 위에 풀 한 포기만 있으면 우스꽝스럽다
        const biased = Math.pow(hash01(seed * 31 + 7), 1.7);
        const kind = Math.min(models.kinds.length - 1, Math.floor(biased * models.kinds.length));
        const model = models.kinds[kind];
        if (count.kinds[kind] >= model.capacity || count.island >= models.island.capacity) continue;

        stairs.surfaceAt(i, this.pos);
        const away = SIDE_MIN + hash01(seed * 17 + 3) * (SIDE_MAX - SIDE_MIN);
        this.pos.x += side * away;
        // 계단 표면보다 아래에 섬을 띄운다 — 시야와 다음 계단을 가리지 않는다
        this.pos.y -= 1.1 + hash01(seed * 13 + 5) * 2.4;
        this.pos.z += (hash01(seed * 7 + 11) - 0.5) * STEP.z * 2;

        const islandScale = 0.8 + hash01(seed * 41 + 13) * 0.5;
        this.quat.setFromAxisAngle(this.up, hash01(seed * 19 + 4) * Math.PI * 2);
        this.scale.set(islandScale, 0.5 + hash01(seed * 29 + 6) * 0.5, islandScale);
        this.matrix.compose(this.pos, this.quat, this.scale);
        models.island.setAt(count.island++, this.matrix);

        // 프롭 — 섬 상단면 위에 세운다
        this.pos.y += models.islandTop * this.scale.y;
        this.quat.setFromAxisAngle(this.up, hash01(seed * 5 + 2) * Math.PI * 2);
        this.scale.setScalar(0.85 + hash01(seed * 23 + 9) * 0.5);
        this.matrix.compose(this.pos, this.quat, this.scale);
        model.setAt(count.kinds[kind], this.matrix);
        count.kinds[kind]++;
      }

    }

    /* ── 원경 레이어 ──
       **근경과 다른 주기(7칸)로 돈다.** 처음에 근경 루프 안에 넣었더니 `i % 3` 필터를
       이미 통과한 층만 검사해 3과 7의 공배수(21칸)마다만 놓였다 —
       배치 테스트로 잡았다 (world/placement.test.ts). */
    for (let i = from; i <= to; i++) {
      if (i % FAR.spacing !== 0) continue;
      const theme = themeForFloor(i);
      const setId = this.sets.has(theme.setId) ? theme.setId : this.defaultSetId;
      const models = this.sets.get(setId);
      const count = counts.get(setId);
      if (!models || !count) continue;

      for (const side of [-1, 1] as const) {
        const seed = i * 2 + (side > 0 ? 1 : 0) + 90_001;
        if (hash01(seed) > this.density * FAR.chance) continue;

        // 원경은 큰 종류를 우선한다 — 멀리 있는 작은 풀은 보이지 않는다
        const biased = Math.pow(hash01(seed * 31 + 7), 2.4);
        const kind = Math.min(models.kinds.length - 1, Math.floor(biased * models.kinds.length));
        const model = models.kinds[kind];
        if (count.kinds[kind] >= model.capacity || count.island >= models.island.capacity) continue;

        stairs.surfaceAt(i, this.pos);
        this.pos.x += side * (FAR.sideMin + hash01(seed * 17 + 3) * (FAR.sideMax - FAR.sideMin));
        this.pos.y -= FAR.dropMin + hash01(seed * 13 + 5) * (FAR.dropMax - FAR.dropMin);
        this.pos.z += (hash01(seed * 7 + 11) - 0.5) * STEP.z * 4;

        const big = FAR.scaleMin + hash01(seed * 41 + 13) * (FAR.scaleMax - FAR.scaleMin);
        this.quat.setFromAxisAngle(this.up, hash01(seed * 19 + 4) * Math.PI * 2);
        this.scale.set(big, big * 0.7, big);
        this.matrix.compose(this.pos, this.quat, this.scale);
        models.island.setAt(count.island++, this.matrix);

        this.pos.y += models.islandTop * this.scale.y;
        this.quat.setFromAxisAngle(this.up, hash01(seed * 5 + 2) * Math.PI * 2);
        this.scale.setScalar(big);
        this.matrix.compose(this.pos, this.quat, this.scale);
        model.setAt(count.kinds[kind], this.matrix);
        count.kinds[kind]++;
      }
    }

    for (const [id, models] of this.sets) {
      const count = counts.get(id)!;
      models.kinds.forEach((model, k) => {
        model.setCount(count.kinds[k]);
        model.commit();
      });
      models.island.setCount(count.island);
      models.island.commit();
    }
  }
}
