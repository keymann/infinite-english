import type { QuizType } from '../quiz/types';

/**
 * 단어 숙련도 (PRD 9장).
 *
 * **한 번 맞혔다고 Mastered 로 처리하지 않는다.** 그건 "안다"가 아니라 "방금 봤다"다.
 * 100% 가 되려면 서로 다른 방향의 문제를 맞히고, **시간이 지난 뒤 다시 맞혀야** 한다.
 *
 * ```
 * □□□□□  0%   처음 만남
 * ■■□□□ 40%   정답 2회
 * ■■■■■ 100%  EN→KO ✓ · KO→EN ✓ · 하루 뒤 재정답 ✓  → WORD MASTER
 * ```
 */

/** 숙련도 단계 수 */
export const MASTERY_STAGES = 5;
/** "시간이 지난 뒤"의 기준 — 하루 */
export const MASTERY_DELAY_MS = 24 * 60 * 60 * 1000;

export type WordProgress = {
  /** 0~5 단계 */
  stage: number;
  /** 정답을 맞힌 문제 유형 */
  clearedTypes: QuizType[];
  /** 하루 이상 지난 뒤 다시 맞혔는지 */
  delayedRecall: boolean;
  right: number;
  wrong: number;
  /** 마지막으로 정답을 맞힌 시각(ms). 0 이면 아직 없음 */
  lastCorrectAt: number;
  /** SM-2 용이자 (review.ts 가 관리) */
  ease: number;
  /** 다음 출제 예정 시각(ms) — 세션 간 큐 */
  dueAt: number;
  /** 연속 정답 (SR 간격 단계) */
  streak: number;
};

export function emptyProgress(): WordProgress {
  return {
    stage: 0,
    clearedTypes: [],
    delayedRecall: false,
    right: 0,
    wrong: 0,
    lastCorrectAt: 0,
    ease: 2.5,
    dueAt: 0,
    streak: 0,
  };
}

/**
 * 정답 처리. 단계를 올리되 **게이트를 통과하지 않으면 100% 가 되지 않는다.**
 * `now` 를 인자로 받는 이유: 테스트에서 시간을 흐르게 만들어야 한다.
 */
export function recordCorrect(p: WordProgress, type: QuizType, now: number): WordProgress {
  const next: WordProgress = { ...p, clearedTypes: [...p.clearedTypes] };
  next.right++;
  next.streak++;
  if (!next.clearedTypes.includes(type)) next.clearedTypes.push(type);

  // 하루 이상 지난 뒤 다시 맞혔다 — 망각곡선을 한 번 넘었다는 증거
  if (p.lastCorrectAt > 0 && now - p.lastCorrectAt >= MASTERY_DELAY_MS) next.delayedRecall = true;
  next.lastCorrectAt = now;

  // 4단계까지는 정답으로 오른다. 마지막 한 칸은 게이트를 통과해야 열린다
  const gatesPassed = isGatePassed(next);
  next.stage = gatesPassed ? MASTERY_STAGES : Math.min(MASTERY_STAGES - 1, next.stage + 1);
  return next;
}

/** 오답 처리. 단계를 **1 내린다** — 0 으로 초기화하면 지금까지의 학습이 부정된다 */
export function recordWrong(p: WordProgress): WordProgress {
  return {
    ...p,
    clearedTypes: [...p.clearedTypes],
    wrong: p.wrong + 1,
    streak: 0,
    stage: Math.max(0, p.stage - 1),
  };
}

/**
 * Mastered 게이트 — 두 방향 + 지연 재인.
 *
 * 그림 문제(IMAGE_TO_EN)는 기록은 하되 **게이트에 넣지 않는다.** 그림이 있는 단어는
 * 14개뿐이라, 게이트에 넣으면 나머지 단어는 영원히 Mastered 가 될 수 없다.
 */
export function isGatePassed(p: WordProgress): boolean {
  return (
    p.clearedTypes.includes('EN_TO_KO') && p.clearedTypes.includes('KO_TO_EN') && p.delayedRecall
  );
}

export function isMastered(p: WordProgress): boolean {
  return p.stage >= MASTERY_STAGES;
}

/** 화면에 보여 줄 0~1 비율 */
export function masteryRatio(p: WordProgress): number {
  return p.stage / MASTERY_STAGES;
}

/** 단어별 정답률. 취약 단어 판정의 기준 */
export function accuracyOf(p: WordProgress): number {
  const total = p.right + p.wrong;
  return total === 0 ? 0 : p.right / total;
}
