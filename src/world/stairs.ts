import * as THREE from 'three';
import type { Dir } from '../core/input';
import type { Rng } from '../core/rng';
import { STEP, type StepStyle } from '../game/balance';
import { InstancedModel } from '../three/instanced';

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

/**
 * 무한 계단 — 절차 생성 + 회수.
 *
 * 계단 i+1 = 계단 i + (dir * STEP.x, STEP.y, -STEP.z).
 * 방향은 시드 난수로 정하므로 같은 시드면 같은 계단이 나온다(이어하기·재현).
 *
 * 계단은 실제로 만들지 않는다. **화면에 필요한 구간만 InstancedMesh 슬롯에 그린다** —
 * 5,000층을 올라도 오브젝트 수는 일정하다.
 */
export class Stairs {
  readonly group: THREE.Group;

  /** dirs[i] = 계단 i-1 에서 i 로 가는 방향. dirs[0] 은 쓰지 않는다 */
  private readonly dirs: Dir[] = [1];
  private readonly rng: Rng;
  private readonly model: InstancedModel;
  /** 블록 모델의 상단면이 원점에서 얼마나 위에 있는지 — 계단 표면 높이를 맞추는 값 */
  private readonly topOffset: number;
  private readonly matrix = new THREE.Matrix4();
  private readonly scratch = new THREE.Vector3();
  /** 계단 번호 → 연출 스타일. 지정되지 않은 칸은 normal */
  private readonly styles = new Map<number, StepStyle>();

  constructor(source: THREE.Object3D, rng: Rng) {
    this.rng = rng;
    const capacity = STEP.ahead + STEP.behind + 2;
    this.model = new InstancedModel(source, capacity);
    this.group = this.model.group;
    this.topOffset = this.model.bbox.max.y;
    this.ensure(capacity);
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
    const to = from + this.model.capacity - 1;
    this.ensure(to);

    let slot = 0;
    for (let i = from; i <= to; i++) {
      this.surfaceAt(i, this.scratch);
      // 블록의 상단면이 계단 표면 높이에 오도록 내려 놓는다
      this.matrix.makeTranslation(this.scratch.x, this.scratch.y - this.topOffset, this.scratch.z);
      this.model.setAt(slot, this.matrix);
      this.model.setColorAt(slot, STYLE_COLOR[this.styles.get(i) ?? 'normal']);
      slot++;
    }
    this.model.setCount(slot);
    this.model.commit();
  }
}
