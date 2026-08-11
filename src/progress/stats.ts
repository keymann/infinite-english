import { accuracyOf, isMastered, type WordProgress } from '../learning/mastery';
import { isWeak } from '../learning/weak';

/**
 * 학습 통계 (PRD 30장).
 *
 * 아이 화면에는 게임만 보여 주고, 이 수치는 부모용 화면(Phase 6)과 밸런싱에 쓴다.
 * 개인정보를 서버로 보내지 않는다 — 전부 로컬에서 계산한다 (PRD 31장).
 */

export type LifetimeStats = {
  /** 누적 출제 수 */
  questions: number;
  correct: number;
  wrong: number;
  /** 문제 풀이 시간 합계(ms) — 평균을 내기 위해 합계로 들고 있는다 */
  answerMsTotal: number;
  /** 최고 연속 정답 */
  bestCombo: number;
  /** 누적 플레이 시간(ms) */
  playMsTotal: number;
  /** 날짜별 플레이 횟수 (YYYY-MM-DD) */
  playsByDay: Record<string, number>;
  bestFloor: number;
  /** 복습으로 다시 낸 문제 중 맞힌 수 — 오답 재학습 성공률의 분자 */
  retryCorrect: number;
  retryTotal: number;
};

export function emptyStats(): LifetimeStats {
  return {
    questions: 0,
    correct: 0,
    wrong: 0,
    answerMsTotal: 0,
    bestCombo: 0,
    playMsTotal: 0,
    playsByDay: {},
    bestFloor: 0,
    retryCorrect: 0,
    retryTotal: 0,
  };
}

export type SessionSummary = {
  questions: number;
  correct: number;
  wrong: number;
  answerMsTotal: number;
  bestCombo: number;
  playMs: number;
  floor: number;
  retryCorrect: number;
  retryTotal: number;
};

export function dayKey(nowMs: number): string {
  // 로컬 시간 기준 — 아이의 "오늘"은 UTC 가 아니다
  const d = new Date(nowMs);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function applySession(
  stats: LifetimeStats,
  session: SessionSummary,
  nowMs: number,
): LifetimeStats {
  const key = dayKey(nowMs);
  return {
    questions: stats.questions + session.questions,
    correct: stats.correct + session.correct,
    wrong: stats.wrong + session.wrong,
    answerMsTotal: stats.answerMsTotal + session.answerMsTotal,
    bestCombo: Math.max(stats.bestCombo, session.bestCombo),
    playMsTotal: stats.playMsTotal + session.playMs,
    playsByDay: { ...stats.playsByDay, [key]: (stats.playsByDay[key] ?? 0) + 1 },
    bestFloor: Math.max(stats.bestFloor, session.floor),
    retryCorrect: stats.retryCorrect + session.retryCorrect,
    retryTotal: stats.retryTotal + session.retryTotal,
  };
}

/** 부모용 요약 (PRD 29장). 13개 지표를 한 번에 계산한다 */
export function report(
  stats: LifetimeStats,
  progress: Record<string, WordProgress>,
  theta: number,
  nowMs: number,
) {
  const entries = Object.entries(progress);
  const weakList = entries
    .filter(([, p]) => isWeak(p))
    .sort((a, b) => accuracyOf(a[1]) - accuracyOf(b[1]))
    .slice(0, 10)
    .map(([id, p]) => ({ wordId: id, accuracy: +(accuracyOf(p) * 100).toFixed(0) }));

  return {
    questions: stats.questions,
    correct: stats.correct,
    wrong: stats.wrong,
    accuracy: stats.questions ? +(stats.correct / stats.questions).toFixed(3) : 0,
    avgAnswerSec: stats.questions ? +(stats.answerMsTotal / stats.questions / 1000).toFixed(1) : 0,
    bestCombo: stats.bestCombo,
    playMinutes: Math.round(stats.playMsTotal / 60000),
    playsToday: stats.playsByDay[dayKey(nowMs)] ?? 0,
    learnedWords: entries.length,
    masteredWords: entries.filter(([, p]) => isMastered(p)).length,
    reviewWords: entries.filter(([, p]) => !isMastered(p) && p.right + p.wrong > 0).length,
    /** 아이에게는 보여 주지 않는다 — 부모·밸런싱용 (PRD 3장) */
    recommendedLevel: +theta.toFixed(1),
    bestFloor: stats.bestFloor,
    /** 오답 재학습 성공률 — KPI 중 하나 */
    retrySuccess: stats.retryTotal ? +(stats.retryCorrect / stats.retryTotal).toFixed(3) : 0,
    weakWords: weakList,
  };
}
