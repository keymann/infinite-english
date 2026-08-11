/**
 * 개인별 난이도 (PRD 7장) — IRT 1PL(라쉬 모형)을 축약한 것.
 *
 * ```
 * p(정답) = 1 / (1 + exp(-(theta - difficulty)))
 * ```
 *
 * `theta` 는 추정 실력, `difficulty` 는 단어 난이도. 둘을 같은 축(0~1 을 0~10 레벨로 늘린 값)에
 * 두고 비교한다. 정답이면 theta 를 올리고 오답이면 내리는데, **한 문항의 변화폭에 상한을 둔다** —
 * 한 문제로 난이도가 크게 뛰면 아이가 "갑자기 어려워졌다"고 느끼고 이탈한다.
 *
 * 출제는 목표 정답률 밴드(75~85%)에서 고른다. 90% 를 넘으면 학습이 일어나지 않고,
 * 60% 미만이면 재미가 없다.
 */

/** theta·difficulty 의 스케일 — level 1~10 을 그대로 쓴다 */
export const THETA_MIN = 1;
export const THETA_MAX = 10;

/**
 * Calibration 중에는 크게, 이후에는 작게 움직인다.
 *
 * "난이도를 갑자기 크게 변경하지 않는다"(PRD 7장)는 **정상 플레이 구간**의 규칙이다.
 * Calibration 은 위치를 빨리 찾기 위한 구간이므로 상한을 크게 둔다 —
 * 상한 0.15 로 묶으면 10문항으로 theta 를 1.5 밖에 못 움직여서, 잘하는 아이는
 * 수십 문제 동안 너무 쉬운 문제를 받는다.
 */
const K_CALIBRATION = 1.4;
const K_STEADY = 0.32;
const MAX_DELTA_CALIBRATION = 0.6;
const MAX_DELTA_STEADY = 0.15;

/** 목표 정답률 밴드 */
export const TARGET_ACCURACY = { min: 0.75, max: 0.85 } as const;

export type Ability = {
  /** 추정 실력 (레벨 스케일) */
  theta: number;
  /** 추정 신뢰도 0~1 — 문항을 풀수록 올라간다 */
  confidence: number;
  /** 지금까지 채점한 문항 수 */
  answered: number;
};

export function initialAbility(startLevel = 2): Ability {
  return { theta: startLevel, confidence: 0, answered: 0 };
}

/** 단어 난이도(0~1) → theta 와 같은 축(1~10) */
export function toThetaScale(difficulty: number): number {
  return THETA_MIN + difficulty * (THETA_MAX - THETA_MIN);
}

export function expectedCorrect(theta: number, difficultyLevel: number): number {
  return 1 / (1 + Math.exp(-(theta - difficultyLevel)));
}

/**
 * 한 문항 채점 후 실력 추정 갱신.
 * `calibrating` 이면 더 크게 움직인다 — 처음 10문제로 대략의 위치를 빨리 잡아야 한다.
 */
export function updateAbility(
  ability: Ability,
  difficulty: number,
  correct: boolean,
  calibrating: boolean,
): Ability {
  const level = toThetaScale(difficulty);
  const expected = expectedCorrect(ability.theta, level);
  const k = calibrating ? K_CALIBRATION : K_STEADY;
  // 예상과 결과의 차이만큼 움직인다. 쉬운 문제를 맞혀도 거의 오르지 않고,
  // 어려운 문제를 맞히면 크게 오른다
  const rawDelta = k * ((correct ? 1 : 0) - expected);
  const cap = calibrating ? MAX_DELTA_CALIBRATION : MAX_DELTA_STEADY;
  const delta = Math.max(-cap, Math.min(cap, rawDelta));

  const answered = ability.answered + 1;
  return {
    theta: Math.max(THETA_MIN, Math.min(THETA_MAX, ability.theta + delta)),
    // 문항이 쌓일수록 신뢰도가 오른다 (20문항에서 약 0.8)
    confidence: Math.min(1, answered / 25),
    answered,
  };
}

/**
 * 지금 낼 문제의 목표 난이도 범위(0~1 스케일).
 * 목표 정답률 밴드를 만족하는 difficulty 구간을 역산한다.
 */
export function levelToUnit(level: number): number {
  return Math.max(0, Math.min(1, (level - THETA_MIN) / (THETA_MAX - THETA_MIN)));
}

/**
 * 목표 난이도 범위를 **레벨 단위**로 돌려준다.
 *
 * 난이도 계산을 전부 레벨 축에서 하는 이유: unit(0~1) 축에서 보정값을 더하면
 * 0.1 이 1레벨에 가까운 큰 점프가 되고, 실력이 하한(theta≈1~2)에 있는 아이에게는
 * 그 한 번의 보정이 정답 확률을 70% → 27% 로 떨어뜨린다.
 * 시뮬레이션에서 초3 수준 학생의 정답률이 53% 로 나온 원인이 이것이었다.
 */
export function targetLevelRange(theta: number): { min: number; max: number } {
  const levelFor = (p: number) => theta + Math.log((1 - p) / p);
  const easiest = levelFor(TARGET_ACCURACY.max);
  const hardest = levelFor(TARGET_ACCURACY.min);
  return { min: Math.min(easiest, hardest), max: Math.max(easiest, hardest) };
}

/** 위 범위를 0~1 난이도 축으로 변환한 것 (단어의 `difficulty` 와 같은 축) */
export function targetDifficultyRange(theta: number): { min: number; max: number } {
  /*
   * p = 1/(1+exp(-(theta-d))) 를 d 로 풀면  d = theta + ln((1-p)/p) 다.
   * 목표 정답률이 높을수록(= 쉬운 문제) d 가 theta 보다 **아래**로 내려간다.
   *
   * ⚠️ 처음에 이 부호를 `theta + ln(p/(1-p))` 로 잘못 써서 목표 난이도가 실력보다
   * 위로 잡혔다(정답률 기대치 20%). 단위 테스트가 잡았다 —
   * 화면만 봐서는 "문제가 좀 어렵네" 정도로 넘어갔을 버그다.
   */
  const levelFor = (p: number) => theta + Math.log((1 - p) / p);
  const easiest = levelFor(TARGET_ACCURACY.max); // 정답률 높음 = 쉬움
  const hardest = levelFor(TARGET_ACCURACY.min);
  const toUnit = (level: number) => (level - THETA_MIN) / (THETA_MAX - THETA_MIN);
  const lo = Math.max(0, Math.min(1, toUnit(easiest)));
  const hi = Math.max(0, Math.min(1, toUnit(hardest)));
  return { min: Math.min(lo, hi), max: Math.max(lo, hi) };
}

/**
 * Calibration — 첫 10문항. 쉬움-보통-어려움을 섞어 낸다 (PRD 7장).
 *
 * **절대 난이도가 아니라 현재 추정 실력 기준의 상대 오프셋(레벨 단위)이다.**
 * 처음에는 절대값(0.1 → 0.7)으로 짰는데, 초3 수준 학생에게 5번째 문제부터 중학교 단어가
 * 나왔다. 시뮬레이션에서 그 학생의 정답률이 48% 로 무너졌고, 틀린 그 단어들이 복습·취약
 * 큐에 쌓여 계속 되돌아왔다. 상대값으로 바꾸면 실력이 낮은 아이에게도
 * "조금 쉬움 → 조금 어려움" 의 파형이 유지된다.
 */
export const CALIBRATION_OFFSETS = [
  -1.2, -0.8, 0.4, -1.0, 1.0, -0.2, 1.3, -0.6, 0.7, 1.5,
] as const;
export const CALIBRATION_COUNT = CALIBRATION_OFFSETS.length;

/** Calibration 중 이번 문항의 목표 난이도(0~1) */
export function calibrationTarget(theta: number, step: number): number {
  const offset = CALIBRATION_OFFSETS[Math.min(step, CALIBRATION_OFFSETS.length - 1)];
  const level = theta + offset;
  return Math.max(0, Math.min(1, (level - THETA_MIN) / (THETA_MAX - THETA_MIN)));
}

export function isCalibrating(ability: Ability): boolean {
  return ability.answered < CALIBRATION_COUNT;
}

/** Calibration 결과 요약 — PRD 7장의 `estimatedLevel` */
export function calibrationSummary(ability: Ability, accuracy: number) {
  return {
    estimatedLevel: +ability.theta.toFixed(1),
    accuracy: +accuracy.toFixed(2),
    confidence: +ability.confidence.toFixed(2),
  };
}
