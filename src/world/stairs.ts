import * as THREE from 'three';
import type { Dir } from '../core/input';
import type { Rng } from '../core/rng';
import { STEP, type StepStyle } from '../game/balance';
import { isBossFloor } from '../game/boss';
import { InstancedModel } from '../three/instanced';
import { themeForFloor, type Theme } from './theme';

/**
 * 무한 계단 — 절차 생성 + 회수 + 월드 테마.
 *
 * 계단 i+1 = 계단 i + (dir * STEP.x, STEP.y, -STEP.z).
 * 방향은 시드 난수로 정하므로 같은 시드면 같은 계단이 나온다(이어하기·재현).
 *
 * 계단은 실제로 만들지 않는다. **화면에 필요한 구간만 InstancedMesh 슬롯에 그린다** —
 * 5,000층을 올라도 오브젝트 수는 일정하다.
 *
 * 층 구간마다 모델 세트가 다르므로 **세트별로 InstancedMesh 를 따로 두고**, 보이는 구간을
 * 세트별로 나눠 담는다. 그래서 체크포인트 위쪽에 다음 월드의 계단이 미리 보인다 —
 * 경계를 흐리지 않는 편이 "올라왔다"는 감각에 유리하다.
 */

/**
 * 콤보 단계별 계단 색. 인스턴스 색은 원래 색에 **곱해지므로** 1을 넘으면 밝아진다.
 * 색만으로 단계가 구분되어야 한다 — 숫자를 읽지 않아도 "지금 잘 되고 있다"가 보인다.
 */
const STYLE_COLOR: Record<StepStyle, THREE.Color> = {
  normal: new THREE.Color(1, 1, 1),
  gold: new THREE.Color(1.9, 1.45, 0.4),
  fire: new THREE.Color(2.2, 0.75, 0.35),
  lightning: new THREE.Color(0.75, 1.25, 2.6),
};

/** 계단 위 소품이 놓일 확률과 위치 */
const DECOR_CHANCE = 0.3;
const DECOR_EDGE = 0.32;

export type StepSet = {
  setId: string;
  /** 계단 블록 원본 — **여러 종류** (층마다 골라 섞는다) */
  steps: THREE.Object3D[];
  /** 가짜 계단 블록 원본 — 갈래 길의 함정 */
  fake: THREE.Object3D;
  /** 계단 위 소품 원본 (없으면 빈 배열) */
  decor: THREE.Object3D[];
};

/**
 * 계단 블록의 목표 크기(월드 유닛).
 *
 * Block Bits 블록은 **2×2×2** 로 만들어져 있고 기존 계단 블록은 1×1×1 이었다.
 * 간격(STEP.x·z = 0.78)보다 크면 서로 겹쳐 빈틈이 생기지 않으므로 1 로 맞춘다.
 * 스케일은 모델 실측 크기에서 계산한다 — 팩마다 제작 스케일이 다르다.
 */
const BLOCK_SIZE = 1;

/** 가짜 계단이 처음 나오는 층 — 조작과 규칙을 익힐 구간을 지나서 */
const FAKE_FROM_FLOOR = 12;
/** 가짜 계단 사이 최소 간격(칸) */
const FAKE_MIN_GAP = 5;
/** 가짜 계단이 놓일 확률 (간격 조건을 통과한 칸에서) */
const FAKE_CHANCE = 0.3;

/** 정수 → [0,1) 결정론적 해시 — 회수·재배치해도 같은 자리에 같은 소품이 온다 */
function hash01(n: number): number {
  let h = Math.imul(n ^ 0x27d4eb2d, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

type Block = {
  model: InstancedModel;
  /** 모델 실측 크기를 BLOCK_SIZE 로 맞추는 배율 */
  scale: number;
  /** 블록 상단면 높이(배율 적용 후) — 계단 표면에 맞춰 내려놓는 값 */
  topOffset: number;
};

type SetModels = {
  /** 계단 블록 종류들 */
  steps: Block[];
  /** 가짜 계단 */
  fake: Block;
  decor: InstancedModel[];
};

/** 모델을 BLOCK_SIZE 기준으로 정규화해 담는다 */
function toBlock(source: THREE.Object3D, capacity: number): Block {
  const model = new InstancedModel(source, capacity);
  const size = model.bbox.getSize(new THREE.Vector3());
  const widest = Math.max(size.x, size.z) || 1;
  const scale = BLOCK_SIZE / widest;
  return { model, scale, topOffset: model.bbox.max.y * scale };
}

export class Stairs {
  readonly group = new THREE.Group();

  /** dirs[i] = 계단 i-1 에서 i 로 가는 방향. dirs[0] 은 쓰지 않는다 */
  private readonly dirs: Dir[] = [1];
  private readonly rng: Rng;
  private readonly sets = new Map<string, SetModels>();
  private defaultSetId = '';
  private readonly matrix = new THREE.Matrix4();
  private readonly scratch = new THREE.Vector3();
  private readonly pos = new THREE.Vector3();
  private readonly quat = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  private readonly tint = new THREE.Color();
  private readonly up = new THREE.Vector3(0, 1, 0);
  /** 계단 번호 → 연출 스타일. 지정되지 않은 칸은 normal */
  private readonly styles = new Map<number, StepStyle>();
  /**
   * 다음에 밟을 칸 — 살짝 밝게 그린다.
   *
   * 처음에는 Platformer 의 방향 표지판(5.4유닛 폭)을 계단에 세웠는데, 이 게임의
   * 3/4 시점에서는 **검은 덩어리로 뭉개져 읽히지 않았다**(배포본에서 확인). 표지판은
   * 측면 시점 플랫포머용 모델이다. 이미 있는 인스턴스 색을 쓰는 편이 즉시 읽힌다.
   */
  private hintIndex = -1;
  /* ── 방향 패턴 구간 ── */
  private pattern: 'zigzag' | 'stair' | 'run' | 'random' = 'random';
  private patternUntil = 0;
  private patternSide: Dir = 1;
  private patternPhase = 0;

  constructor(sets: readonly StepSet[], rng: Rng) {
    this.rng = rng;
    for (const set of sets) this.addSet(set);
    this.ensure(this.capacity);
  }

  /** 나중에 로드된 세트를 추가한다 (월드2 는 백그라운드로 받는다) */
  addSet(set: StepSet) {
    if (this.sets.has(set.setId)) return;
    const capacity = STEP.ahead + STEP.behind + 2;
    const models: SetModels = {
      steps: set.steps.map((m) => toBlock(m, capacity)),
      // 가짜는 한 화면에 많이 나오지 않는다 — 슬롯을 적게 잡는다
      fake: toBlock(set.fake, Math.ceil(capacity / FAKE_MIN_GAP) + 2),
      decor: set.decor.map((d) => new InstancedModel(d, capacity)),
    };
    for (const b of models.steps) this.group.add(b.model.group);
    this.group.add(models.fake.model.group);
    for (const d of models.decor) this.group.add(d.group);
    this.sets.set(set.setId, models);
    if (!this.defaultSetId) this.defaultSetId = set.setId;
  }

  hasSet(setId: string): boolean {
    return this.sets.has(setId);
  }

  private get capacity(): number {
    return STEP.ahead + STEP.behind + 2;
  }

  /** 아직 로드되지 않은 세트는 기본 세트로 대체한다 — 계단이 사라지면 안 된다 */
  private modelsFor(theme: Theme): SetModels {
    return this.sets.get(theme.setId) ?? this.sets.get(this.defaultSetId)!;
  }

  /**
   * 계단 i 까지의 방향을 미리 정해 둔다.
   *
   * ## 왜 패턴 구간으로 나누는가
   *
   * 매 칸을 독립 난수로 뽑으면 **어느 구간이나 똑같이 느껴진다** — 무작위는 리듬이 없다.
   * 그래서 몇 칸씩 묶어 패턴을 하나 고르고 그 구간을 그 패턴으로 채운다.
   * 지그재그 구간은 손가락이 번갈아 움직이고, 직진 구간은 같은 쪽을 연타하고,
   * 계단 구간은 둘·둘로 끊긴다 — 구간이 바뀌는 순간에 리듬을 다시 잡아야 한다.
   *
   * `STEP.maxRun` 은 그대로 지킨다. 같은 방향이 길게 이어지면 계단이 한쪽으로 쭉 뻗어
   * 화면을 벗어나고, "계속 오른쪽"은 조작이 아니라 연타가 된다.
   */
  private ensure(index: number) {
    while (this.dirs.length <= index) {
      const i = this.dirs.length;

      if (i >= this.patternUntil) this.pickPattern(i);

      let dir: Dir;
      switch (this.pattern) {
        case 'zigzag':
          // 번갈아 — 가장 읽기 쉬운 리듬
          dir = (-this.dirs[i - 1] || 1) as Dir;
          break;
        case 'stair':
          // 둘씩 같은 쪽 — 둘·둘로 끊기는 리듬
          dir = (this.patternPhase % 4 < 2 ? this.patternSide : -this.patternSide) as Dir;
          break;
        case 'run':
          // 같은 쪽으로 이어 간다 (maxRun 에서 꺾인다)
          dir = this.patternSide;
          break;
        default:
          dir = this.rng() < 0.5 ? -1 : 1;
      }
      this.patternPhase++;

      let run = 0;
      for (let k = i - 1; k >= 1 && this.dirs[k] === dir; k--) run++;
      if (run >= STEP.maxRun) dir = (-dir) as Dir;

      this.dirs.push(dir);
    }
  }

  /** 다음 패턴 구간을 고른다 */
  private pickPattern(from: number) {
    const roll = this.rng();
    this.pattern =
      roll < 0.34 ? 'zigzag' : roll < 0.58 ? 'stair' : roll < 0.78 ? 'run' : 'random';
    // 구간 길이 4~9칸 — 짧으면 패턴이 인식되지 않고, 길면 지루해진다
    this.patternUntil = from + 4 + Math.floor(this.rng() * 6);
    this.patternSide = this.rng() < 0.5 ? -1 : 1;
    this.patternPhase = 0;
  }

  /**
   * 이 칸에 **가짜 계단**(갈래 길)이 있는지.
   *
   * 진짜 계단의 반대쪽에 블록 하나가 더 놓인다 — 두 갈래로 보이지만 한쪽은 밟으면 끝이다.
   * 판정은 층 번호만으로 결정론적이다(시드와 무관) — 같은 층은 늘 같은 함정이어야
   * 아이가 "저 블록은 가짜다"를 배울 수 있다.
   *
   * 조건: 12층부터 · 최소 5칸 간격 · 보스 층은 제외(관문과 함정이 겹치면 원인을 못 읽는다).
   */
  hasFake(index: number): boolean {
    if (index < FAKE_FROM_FLOOR) return false;
    if (isBossFloor(index)) return false;
    if (hash01(index * 101 + 7) > FAKE_CHANCE) return false;
    // 앞선 칸에 이미 가짜가 있으면 건너뛴다 — 연달아 나오면 운에 맡기는 게임이 된다
    for (let k = index - 1; k > index - FAKE_MIN_GAP && k >= FAKE_FROM_FLOOR; k--) {
      if (!isBossFloor(k) && hash01(k * 101 + 7) <= FAKE_CHANCE) return false;
    }
    return true;
  }

  /** 계단 i 로 가는 방향 */
  dirAt(index: number): Dir {
    this.ensure(index);
    return this.dirs[index];
  }

  /** 계단 i 의 **표면 중심** 좌표 (캐릭터가 서는 지점) */
  surfaceAt(index: number, out = new THREE.Vector3()): THREE.Vector3 {
    this.ensure(index);
    let x = 0;
    for (let i = 1; i <= index; i++) x += this.dirs[i] * STEP.x;
    return out.set(x, index * STEP.y, -index * STEP.z);
  }

  /**
   * 계단 구간에 연출 스타일을 입힌다 (정답으로 구간이 열릴 때).
   * 화면을 벗어난 칸의 기록은 버린다 — 5,000층을 오르면 Map 이 무한히 커진다.
   */
  setStyle(fromIndex: number, toIndex: number, style: StepStyle) {
    for (let i = fromIndex; i <= toIndex; i++) {
      if (style === 'normal') this.styles.delete(i);
      else this.styles.set(i, style);
    }
    for (const key of this.styles.keys()) {
      if (key < fromIndex - STEP.behind - 4) this.styles.delete(key);
    }
  }

  clearStyles() {
    this.styles.clear();
    this.hintIndex = -1;
  }

  /** 다음에 밟을 칸을 표시한다 (-1 이면 없음) */
  setHint(index: number) {
    this.hintIndex = index;
  }

  /**
   * 현재 위치를 중심으로 보이는 구간만 인스턴스 슬롯에 채운다.
   * 슬롯 번호는 계단 번호와 무관하다 — 재사용되는 자리일 뿐이다.
   */
  refresh(currentIndex: number) {
    const from = Math.max(0, currentIndex - STEP.behind);
    const to = from + this.capacity - 1;
    this.ensure(to);

    // 세트마다, 블록 종류마다 슬롯 카운터를 따로 센다
    const stepCount = new Map<string, number[]>();
    const fakeCount = new Map<string, number>();
    const decorCount = new Map<string, number[]>();
    for (const [id, models] of this.sets) {
      stepCount.set(id, models.steps.map(() => 0));
      fakeCount.set(id, 0);
      decorCount.set(id, models.decor.map(() => 0));
    }

    for (let i = from; i <= to; i++) {
      const theme = themeForFloor(i);
      const models = this.modelsFor(theme);
      const setId = this.sets.has(theme.setId) ? theme.setId : this.defaultSetId;

      // 콤보 연출 색 × 테마 색조 — 같은 금색이 저녁 숲과 밤 성에서 다르게 보인다
      this.tint.copy(STYLE_COLOR[this.styles.get(i) ?? 'normal']).multiply(theme.stepTint);
      // 다음에 밟을 칸은 밝게 — 어느 쪽으로 눌러야 하는지가 색으로 보인다
      if (i === this.hintIndex) this.tint.multiplyScalar(1.45);

      this.surfaceAt(i, this.scratch);
      const kind = this.blockKindAt(i, models.steps.length);
      const block = models.steps[kind];
      const slots = stepCount.get(setId)!;
      if (slots[kind] < block.model.capacity) {
        this.placeBlock(block, slots[kind], this.scratch);
        block.model.setColorAt(slots[kind], this.tint);
        slots[kind]++;
      }

      /* 가짜 계단 — 진짜의 **반대쪽**에 놓는다. 두 갈래로 보이지만 한쪽은 밟으면 끝이다.
         색조를 곱하지 않는다: 테마에 물들면 이질감이 사라져 함정이 불공정해진다 */
      if (this.hasFake(i)) {
        const fakeSlot = fakeCount.get(setId)!;
        if (fakeSlot < models.fake.model.capacity) {
          this.surfaceAt(i, this.scratch);
          // 진짜 칸이 온 방향의 반대쪽 — 직전 칸에서 갈라진다
          this.scratch.x -= this.dirs[i] * STEP.x * 2;
          this.placeBlock(models.fake, fakeSlot, this.scratch);
          fakeCount.set(setId, fakeSlot + 1);
        }
      }

      this.placeDecor(i, models, setId, decorCount);
    }

    for (const [id, models] of this.sets) {
      const slots = stepCount.get(id)!;
      models.steps.forEach((block, k) => {
        block.model.setCount(slots[k]);
        block.model.commit();
      });
      models.fake.model.setCount(fakeCount.get(id)!);
      models.fake.model.commit();
      models.decor.forEach((model, k) => {
        model.setCount(decorCount.get(id)![k]);
        model.commit();
      });
    }
  }

  /**
   * 이 층에 쓸 블록 종류.
   *
   * 층 번호만으로 정한다 — 회수·재배치해도 같은 층에 같은 블록이 온다.
   * 같은 종류가 3칸 넘게 이어지지 않게 살짝 흔든다: 한 종류가 길게 이어지면
   * 종류를 늘린 값이 사라진다.
   */
  private blockKindAt(index: number, count: number): number {
    if (count <= 1) return 0;
    const base = Math.floor(hash01(index * 37 + 13) * count) % count;
    const prev = index > 0 ? Math.floor(hash01((index - 1) * 37 + 13) * count) % count : -1;
    const prev2 = index > 1 ? Math.floor(hash01((index - 2) * 37 + 13) * count) % count : -1;
    return base === prev && base === prev2 ? (base + 1) % count : base;
  }

  /** 블록 상단면이 계단 표면 높이에 오도록 내려 놓는다 (모델 크기 정규화 포함) */
  private placeBlock(block: Block, slot: number, surface: THREE.Vector3) {
    this.scale.setScalar(block.scale);
    this.quat.identity();
    this.pos.set(surface.x, surface.y - block.topOffset, surface.z);
    this.matrix.compose(this.pos, this.quat, this.scale);
    block.model.setAt(slot, this.matrix);
  }

  /** 계단 위 소품 — 밟는 자리를 피해 모서리에 놓는다 */
  private placeDecor(
    index: number,
    models: SetModels,
    setId: string,
    counts: Map<string, number[]>,
  ) {
    if (models.decor.length === 0 || index === 0) return;
    const roll = hash01(index * 7 + 1);
    if (roll > DECOR_CHANCE) return;

    const kind = Math.floor(hash01(index * 31 + 5) * models.decor.length);
    const model = models.decor[kind];
    const slots = counts.get(setId)!;
    if (slots[kind] >= model.capacity) return;

    this.surfaceAt(index, this.scratch);
    // 다음 칸이 가는 쪽의 반대 모서리에 둔다 — 캐릭터가 지나갈 자리를 비운다
    const side = -this.dirAt(index + 1);
    this.scratch.x += side * DECOR_EDGE;
    this.scratch.z += DECOR_EDGE * (hash01(index * 13 + 3) > 0.5 ? 1 : -1);

    this.quat.setFromAxisAngle(this.up, hash01(index * 17 + 9) * Math.PI * 2);
    this.scale.setScalar(0.7 + hash01(index * 23 + 11) * 0.5);
    this.matrix.compose(this.scratch, this.quat, this.scale);
    model.setAt(slots[kind], this.matrix);
    slots[kind]++;
  }
}
