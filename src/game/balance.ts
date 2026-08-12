/**
 * 모든 밸런스 수치는 이 파일 한 곳에만 둔다.
 * 밸런싱은 반복 작업이고, 수치가 코드 곳곳에 흩어지면 되돌릴 수 없다.
 */

/** 계단 한 칸의 간격. 블록 모델은 1×1×1 이므로 간격이 1 미만이면 서로 겹쳐 빈틈이 안 생긴다. */
export const STEP = {
  /** 좌/우 지그재그 간격 */
  x: 0.78,
  /** 한 칸 높이 */
  y: 0.46,
  /** 화면 안쪽으로 멀어지는 간격 */
  z: 0.78,
  /** 같은 방향이 이어질 수 있는 최대 횟수. 넘으면 반대로 꺾는다 */
  maxRun: 3,
  /** 앞쪽으로 미리 만들어 두는 칸 수 */
  ahead: 22,
  /** 뒤쪽으로 남겨 두는 칸 수 (카메라에 잡히는 만큼) */
  behind: 4,
} as const;

export const CLIMB = {
  /** 한 칸 오르는 시간(초). 짧아야 "탁탁" 오르는 감각이 난다 */
  jumpSec: 0.17,
  /** 점프 아치 높이 */
  hopHeight: 0.22,
  /**
   * 방향을 틀렸을 때 판이 끝나기까지의 연출 시간(초).
   *
   * **방향 오선택은 즉시 판을 끝낸다.** 원작(무한의 계단)의 규칙이고 요청 사항이다.
   * 이전에는 휘청이기만 하고 죽지 않았다(PRD 3.2절) — 그 판단을 뒤집었다.
   * 아이가 "왜 끝났는지" 볼 시간은 필요하므로 즉시 암전하지 않고 이 시간만큼 보여 준다.
   * 조작이 어려운 아이에게는 `?autodir=1`(방향 자동 보정)이 그대로 남아 있다.
   */
  stumbleSec: 0.55,
  /** 연속 입력 버퍼 — 점프 중 누른 입력을 이 시간 안에는 기억한다 */
  inputBufferSec: 0.12,
} as const;

/**
 * 계단 타이머 (한 칸에 머무를 수 있는 시간).
 *
 * 한 칸을 밟을 때마다 다시 찬다. 0 이 되면 판이 끝난다 — 계단을 오르는 구간에
 * "생각할 시간"이 아니라 "리듬"을 요구하는 장치다.
 *
 * **높은 층일수록 짧아지고 하한은 2초다.** 하한이 없으면 어느 층부터는 인간이
 * 반응할 수 없는 시간이 되어 실력과 무관하게 끝난다.
 * **보스전에는 적용하지 않는다** — 보스전은 계단이 잠기고 문제를 푸는 구간이므로
 * 계단 시간을 재는 것이 의미가 없고, 문제를 읽을 시간을 빼앗으면 안 된다.
 */
export const STAIR_TIMER = {
  /** 0층에서의 제한 시간(초) */
  startSec: 5,
  /** 한 층마다 줄어드는 양(초) — 300층에서 하한에 닿는다 */
  decayPerFloor: 0.01,
  /** 하한(초). 요구 사항의 최소값 */
  minSec: 2,
} as const;

/** 그 층에서 한 칸에 허용되는 시간(초) */
export function stairTimeFor(floor: number): number {
  const raw = STAIR_TIMER.startSec - Math.max(0, floor) * STAIR_TIMER.decayPerFloor;
  return Math.max(STAIR_TIMER.minSec, raw);
}

export const CAMERA = {
  fov: 42,
  /**
   * 플레이어 기준 카메라 오프셋 (고정각 — 수직 회전 없음).
   * 앞쪽 계단이 **최소 8칸** 보여야 방향을 미리 읽고 리듬을 탈 수 있다.
   * 가까이 붙이면 다음 한 칸만 보이고, 그러면 조작이 반사 신경 시험이 된다.
   */
  offset: { x: 0, y: 5.2, z: 9.4 },
  /**
   * 바라보는 지점의 높이 보정.
   *
   * 이 값이 크면 카메라가 위를 보고 **캐릭터가 화면 아래로 내려간다.** 처음에 2.4 로 뒀더니
   * 화면 아래 30% 를 차지하는 퀴즈 패널에 캐릭터가 가려졌다. 계단은 위·안쪽으로 뻗으므로
   * 이 값을 낮춰도 앞쪽 계단은 충분히 보인다.
   */
  lookAtY: 1.0,
  /**
   * 축별 추적 속도(1/초). X 를 느리게 잡는 이유: 지그재그를 그대로 따라가면
   * 화면이 좌우로 흔들려 멀미가 난다.
   */
  follow: { x: 3.2, y: 7.5, z: 7.5 },
} as const;

/**
 * 콤보 단계.
 *
 * **콤보가 곧 계단 길이다** — 정답 보상이 점수 숫자가 아니라 게임 액션으로 나타난다
 * (PRD 35장 3항).
 *
 * 구간을 1~4칸에서 **4~12칸으로 늘렸다.** 1칸이면 한 문제 풀고 한 번 탭하는 것이라
 * 계단을 오르는 감각이 생기기 전에 문제가 다시 뜬다 — "몇 칸 오를 때마다 문제가 나와
 * 집중이 끊긴다"는 지적이 정확했다. 문제 총량은 보스전으로 옮겼다 (game/boss.ts).
 */
export const COMBO_TIERS = [
  { min: 0, segment: 4, style: 'normal', label: '' },
  { min: 3, segment: 6, style: 'normal', label: 'COMBO x3' },
  { min: 5, segment: 8, style: 'gold', label: 'GOLD STEP' },
  { min: 10, segment: 10, style: 'fire', label: 'FIRE STEP' },
  { min: 20, segment: 12, style: 'lightning', label: 'ULTRA COMBO' },
] as const;

export type StepStyle = (typeof COMBO_TIERS)[number]['style'];

export const RULES = {
  /** 시작 HP. 오답 1회당 1 감소 — **영어 오답 전용이다** */
  hp: 3,
  /** 정답 점수 */
  scoreBase: 10,
  /** 재출제(복습) 정답은 절반만 인정한다. 같은 단어를 반복해 점수를 벌 수 없게 */
  scoreRetry: 5,
  /** 콤보 1당 추가 점수 */
  scoreComboBonus: 2,
  /** 오답 피드백을 보여 주는 시간(초). 정답을 확인할 최소 시간은 주되 흐름은 끊지 않는다 */
  wrongFeedbackSec: 1.1,
  /** 정답 피드백 — 바로 계단이 열리므로 짧다 */
  correctFeedbackSec: 0.25,
} as const;

/**
 * 체크포인트 — 10층마다 (PRD 1장).
 * "얼마나 왔는지"를 층 숫자만으로 느끼기는 어렵다. 10층마다 한 번 크게 알려 준다.
 */
export const CHECKPOINT_EVERY = 10;

export const PLAYER = {
  /** 계단 블록(1유닛) 대비 캐릭터 키. 모델 실측값으로 런타임에 맞춘다 */
  height: 0.92,
  /** 착지 시 카메라 흔들림 */
  landShake: 0.035,
} as const;
