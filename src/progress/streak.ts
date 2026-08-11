import { dayKey } from './stats';

/**
 * 연속 학습 기록 (PRD 22장).
 *
 * **하루 빠졌다고 전부 초기화하지 않는다.** 30일을 쌓은 아이가 하루 아팠다고 1일로
 * 돌아가면, 그 아이는 다시 시작하지 않는다. Streak Shield 가 하루를 막아 준다.
 *
 * ```
 * 어제 플레이 → +1
 * 오늘 이미 플레이 → 변화 없음
 * 이틀 전 마지막 (하루 빠짐) → 방패가 있으면 방패를 쓰고 유지, 없으면 1일로
 * 사흘 이상 → 1일로 (여기서도 최고 기록은 남는다)
 * ```
 */

export type StreakState = {
  days: number;
  /** 하루 결석을 막아 주는 방패 */
  shields: number;
  /** 마지막으로 플레이한 날 (YYYY-MM-DD) */
  lastDay: string;
  best: number;
};

/** 며칠 연속마다 방패를 하나 준다 */
export const SHIELD_EVERY = 7;
export const MAX_SHIELDS = 2;
/** 기념하는 지점 (PRD 22장) */
export const STREAK_MILESTONES = [3, 7, 14, 30, 100];

export function emptyStreak(): StreakState {
  return { days: 0, shields: 0, lastDay: '', best: 0 };
}

function daysBetween(fromDay: string, toDay: string): number {
  const [y1, m1, d1] = fromDay.split('-').map(Number);
  const [y2, m2, d2] = toDay.split('-').map(Number);
  const a = Date.UTC(y1, m1 - 1, d1);
  const b = Date.UTC(y2, m2 - 1, d2);
  return Math.round((b - a) / 86_400_000);
}

export type StreakResult = {
  state: StreakState;
  /** 오늘 처음 플레이해서 기록이 늘었는지 */
  extended: boolean;
  /** 방패를 써서 유지했는지 — 아이에게 알려 줄 가치가 있다 */
  shieldUsed: boolean;
  /** 이번에 도달한 기념 지점 (없으면 null) */
  milestone: number | null;
  /** 이번에 방패를 얻었는지 */
  shieldEarned: boolean;
};

/** 판을 시작할 때 호출한다 */
export function touch(state: StreakState, nowMs: number): StreakResult {
  const today = dayKey(nowMs);
  const idle: StreakResult = {
    state,
    extended: false,
    shieldUsed: false,
    milestone: null,
    shieldEarned: false,
  };

  if (state.lastDay === today) return idle;

  const gap = state.lastDay ? daysBetween(state.lastDay, today) : Infinity;
  let days: number;
  let shields = state.shields;
  let shieldUsed = false;

  if (gap === 1 || state.lastDay === '') {
    days = state.days + 1;
  } else if (gap === 2 && shields > 0) {
    // 하루 빠졌다 — 방패로 막는다
    shields--;
    shieldUsed = true;
    days = state.days + 1;
  } else {
    days = 1;
  }

  let shieldEarned = false;
  if (days % SHIELD_EVERY === 0 && shields < MAX_SHIELDS) {
    shields++;
    shieldEarned = true;
  }

  const milestone = STREAK_MILESTONES.includes(days) ? days : null;

  return {
    state: { days, shields, lastDay: today, best: Math.max(state.best, days) },
    extended: true,
    shieldUsed,
    milestone,
    shieldEarned,
  };
}
