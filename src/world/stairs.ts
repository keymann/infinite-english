import * as THREE from 'three';
import type { Dir } from '../core/input';
import type { Rng } from '../core/rng';
import { STEP, type StepStyle } from '../game/balance';
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
  /** 계단 블록 원본 */
  step: THREE.Object3D;
  /** 계단 위 소품 원본 (없으면 빈 배열) */
  decor: THREE.Object3D[];
};

/** 정수 → [0,1) 결정론적 해시 — 회수·재배치해도 같은 자리에 같은 소품이 온다 */
function hash01(n: number): number {
  let h = Math.imul(n ^ 0x27d4eb2d, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

type SetModels = {
  step: InstancedModel;
  /** 블록 상단면 높이 — 계단 표면에 맞춰 내려놓는 값 */
  topOffset: number;
  decor: InstancedModel[];
};

export class Stairs {
  readonly group = new THREE.Group();

  /** dirs[i] = 계단 i-1 에서 i 로 가는 방향. dirs[0] 은 쓰지 않는다 */
  private readonly dirs: Dir[] = [1];
  private readonly rng: Rng;
  private readonly sets = new Map<string, SetModels>();
  private defaultSetId = '';
  private readonly matrix = new THREE.Matrix4();
  private readonly scratch = new THREE.Vector3();
  private readonly quat = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  private readonly tint = new THREE.Color();
  private readonly up = new THREE.Vector3(0, 1, 0);
  /** 계단 번호 → 연출 스타일. 지정되지 않은 칸은 normal */
  private readonly styles = new Map<number, StepStyle>();

  constructor(sets: readonly StepSet[], rng: Rng) {
    this.rng = rng;
    for (const set of sets) this.addSet(set);
    this.ensure(this.capacity);
  }

  /** 나중에 로드된 세트를 추가한다 (월드2 는 백그라운드로 받는다) */
  addSet(set: StepSet) {
    if (this.sets.has(set.setId)) return;
    const capacity = STEP.ahead + STEP.behind + 2;
    const step = new InstancedModel(set.step, capacity);
    const models: SetModels = {
      step,
      topOffset: step.bbox.max.y,
      decor: set.decor.map((d) => new InstancedModel(d, capacity)),
    };
    this.group.add(step.group);
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

  /** 계단 i 까지의 방향을 미리 정해 둔다 */
  private ensure(index: number) {
    while (this.dirs.length <= index) {
      const i = this.dirs.length;
      let dir: Dir = this.rng() < 0.5 ? -1 : 1;

      // 같은 방향이 너무 길게 이어지면 계단이 한쪽으로 쭉 뻗어 화면을 벗어난다.
      // 또 "계속 오른쪽"은 조작이 아니라 연타가 되어 버린다.
      let run = 0;
      for (let k = i - 1; k >= 1 && this.dirs[k] === dir; k--) run++;
      if (run >= STEP.maxRun) dir = (-dir) as Dir;

      this.dirs.push(dir);
    }
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
  }

  /**
   * 현재 위치를 중심으로 보이는 구간만 인스턴스 슬롯에 채운다.
   * 슬롯 번호는 계단 번호와 무관하다 — 재사용되는 자리일 뿐이다.
   */
  refresh(currentIndex: number) {
    const from = Math.max(0, currentIndex - STEP.behind);
    const to = from + this.capacity - 1;
    this.ensure(to);

    // 세트마다 슬롯 카운터를 따로 센다
    const stepCount = new Map<string, number>();
    const decorCount = new Map<string, number[]>();
    for (const [id, models] of this.sets) {
      stepCount.set(id, 0);
      decorCount.set(id, models.decor.map(() => 0));
    }

    for (let i = from; i <= to; i++) {
      const theme = themeForFloor(i);
      const models = this.modelsFor(theme);
      const setId = this.sets.has(theme.setId) ? theme.setId : this.defaultSetId;

      this.surfaceAt(i, this.scratch);
      const slot = stepCount.get(setId)!;

      // 블록의 상단면이 계단 표면 높이에 오도록 내려 놓는다
      this.matrix.makeTranslation(
        this.scratch.x,
        this.scratch.y - models.topOffset,
        this.scratch.z,
      );
      models.step.setAt(slot, this.matrix);

      // 콤보 연출 색 × 테마 색조 — 같은 금색이 저녁 숲과 밤 성에서 다르게 보인다
      this.tint.copy(STYLE_COLOR[this.styles.get(i) ?? 'normal']).multiply(theme.stepTint);
      models.step.setColorAt(slot, this.tint);
      stepCount.set(setId, slot + 1);

      this.placeDecor(i, models, setId, decorCount);
    }

    for (const [id, models] of this.sets) {
      models.step.setCount(stepCount.get(id)!);
      models.step.commit();
      models.decor.forEach((model, k) => {
        model.setCount(decorCount.get(id)![k]);
        model.commit();
      });
    }
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
