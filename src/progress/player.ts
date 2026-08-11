/**
 * 캐릭터 성장 (PRD 15·16장).
 *
 * 핵심은 수치가 아니라 **연결**이다. 경험치는 영어 문제를 맞혀야만 오르고,
 * 능력치 4종은 RPG 스탯이 아니라 **학습 성과를 게임 언어로 번역한 것**이다.
 *
 * ```
 * STR    ← 최고 연속 정답        "끈기"
 * SPEED  ← 빠르게 맞힌 횟수       "반응"
 * INT    ← 어려운 단어 정답 횟수   "실력"
 * MEMORY ← Mastered 단어 수      "기억"
 * ```
 *
 * 그래서 아이가 능력치를 올리려면 학습 방식을 바꿔야 한다 — 스탯 찍기가 아니다.
 */

export type PlayerState = {
  level: number;
  /** 현재 레벨에서 모은 경험치 */
  exp: number;
  gold: number;
  /** SPEED 근거 — 빠르게 맞힌 누적 횟수 */
  fastCorrect: number;
  /** INT 근거 — 고난도 단어 정답 누적 횟수 */
  hardCorrect: number;
};

export function emptyPlayer(): PlayerState {
  return { level: 1, exp: 0, gold: 0, fastCorrect: 0, hardCorrect: 0 };
}

/** 빠른 정답 기준(ms) — 3초 안에 고르면 "알고 있는" 것으로 본다 */
export const FAST_ANSWER_MS = 3000;
/** 고난도 기준 — 난이도 0.5 이상 (레벨 5.5 이상) */
export const HARD_DIFFICULTY = 0.5;

/** 다음 레벨까지 필요한 경험치. 완만하게 올린다 — 성장이 멈추면 이탈한다 */
export function expToNext(level: number): number {
  return 80 + (level - 1) * 50;
}

/** 정답 하나의 경험치. 어려운 문제와 높은 콤보가 더 많이 준다 */
export function expForAnswer(options: {
  difficulty: number;
  combo: number;
  isRetry: boolean;
}): number {
  const base = 10 + Math.round(options.difficulty * 20);
  const comboBonus = Math.min(20, options.combo * 2);
  // 복습 정답은 절반 — 같은 단어를 반복해 경험치를 벌 수 없게
  return Math.max(1, Math.round((base + comboBonus) * (options.isRetry ? 0.5 : 1)));
}

/** 정답 하나의 골드 */
export function goldForAnswer(isRetry: boolean): number {
  return isRetry ? 2 : 3;
}

/** 체크포인트(10층) 통과 보너스 골드 — 높이 올라갈수록 커진다 */
export function goldForCheckpoint(floor: number): number {
  return 10 + Math.floor(floor / 10) * 5;
}

export type LevelUp = { from: number; to: number };

/** 경험치를 더한다. 여러 레벨이 한 번에 오를 수 있다 */
export function addExp(player: PlayerState, exp: number): { player: PlayerState; levelUp: LevelUp | null } {
  const next: PlayerState = { ...player, exp: player.exp + exp };
  const from = next.level;
  while (next.exp >= expToNext(next.level)) {
    next.exp -= expToNext(next.level);
    next.level++;
  }
  return { player: next, levelUp: next.level > from ? { from, to: next.level } : null };
}

export function addGold(player: PlayerState, gold: number): PlayerState {
  return { ...player, gold: player.gold + gold };
}

export type Abilities = { str: number; speed: number; int: number; memory: number };

/**
 * 능력치 계산. 누적 학습 기록에서 파생되므로 **따로 저장하지 않는다** —
 * 저장값을 따로 두면 두 값이 어긋나는 순간이 반드시 온다.
 */
export function abilitiesOf(source: {
  bestCombo: number;
  fastCorrect: number;
  hardCorrect: number;
  masteredWords: number;
}): Abilities {
  return {
    str: source.bestCombo,
    speed: source.fastCorrect,
    int: source.hardCorrect,
    memory: source.masteredWords,
  };
}

/** 진행 바 표시용 0~1 */
export function expRatio(player: PlayerState): number {
  return Math.min(1, player.exp / expToNext(player.level));
}
