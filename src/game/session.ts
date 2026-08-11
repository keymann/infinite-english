import type { Rng } from '../core/rng';
import type { LearningEngine, Pick } from '../learning/engine';
import type { WordBank } from '../learning/words';
import { generateQuiz, isCorrect } from '../quiz/generator';
import type { Quiz } from '../quiz/types';
import type { SessionSummary } from '../progress/stats';
import { FAST_ANSWER_MS, HARD_DIFFICULTY } from '../progress/player';
import { COMBO_TIERS, RULES, type StepStyle } from './balance';

/**
 * 한 판의 진행 — 퀴즈 ↔ 계단 구간의 왕복.
 *
 * ```
 * 문제 → 정답 → 계단 구간 N칸 개방 → 좌/우 탭으로 오름 → 다음 문제
 *          └ 오답 → HP-1 → (HP 0 이면) REVIVE → 정답이면 부활, 오답이면 종료
 * ```
 *
 * **타이머를 이 클래스에 두지 않는다.** 피드백 표시 시간 같은 연출 지연은 UI 쪽에서
 * 관리하고, 여기서는 `answer()` → `next()` 라는 상태 전이만 제공한다.
 * 그래야 학습 로직 테스트를 시간 없이 결정론적으로 돌릴 수 있다.
 *
 * 무엇을 낼지는 이 클래스가 정하지 않는다 — `LearningEngine` 이 정한다.
 * 게임 규칙(HP·콤보·구간)과 학습 규칙(출제·Mastery·SR)을 분리해 둔다 (PRD 37장).
 */

export type Phase = 'quiz' | 'climbing' | 'revive' | 'over';

export type AnswerResult = {
  correct: boolean;
  correctIndex: number;
  /** 정답으로 열린 계단 칸 수 (오답이면 0) */
  segment: number;
  style: StepStyle;
  /** 이번 정답으로 콤보 단계가 올라갔는지 — 연출을 강화할 시점 */
  tierUp: boolean;
  comboLabel: string;
  hp: number;
  phase: Phase;
  /** 이번 정답으로 이 단어가 Mastered 가 되었는지 — WORD MASTER 연출 */
  mastered: boolean;
  /** 단어 숙련도 단계 (0~5) */
  stage: number;
  word: string;
  /** 성장 계산에 필요한 값 — 경험치는 난이도·속도를 반영한다 (progress/player.ts) */
  difficulty: number;
  /** 빠르게 맞혔는지 (SPEED 능력치) */
  fast: boolean;
  isRetry: boolean;
};

export type SessionStats = {
  asked: number;
  correct: number;
  wrong: number;
  accuracy: number;
  bestCombo: number;
  score: number;
  floor: number;
  wrongWords: string[];
  masteredWords: string[];
};

export class Session {
  phase: Phase = 'quiz';
  hp: number = RULES.hp;
  combo = 0;
  bestCombo = 0;
  score = 0;
  asked = 0;
  correctCount = 0;
  wrongCount = 0;
  quiz: Quiz | null = null;
  /** 남은 계단 칸 수 — 0 이 되면 다음 문제로 넘어간다 */
  stepsLeft = 0;

  private readonly bank: WordBank;
  private readonly engine: LearningEngine;
  private readonly rng: Rng;
  private readonly clock: () => number;
  private readonly wrongWords = new Set<string>();
  private readonly masteredWords: string[] = [];
  private tierIndex = 0;
  private pick: Pick | null = null;
  /** 문제가 화면에 뜬 시각 — 풀이 시간 측정 */
  private shownAt = 0;
  private answerMsTotal = 0;
  private retryCorrect = 0;
  private retryTotal = 0;
  private fastCorrect = 0;
  private hardCorrect = 0;
  private readonly startedAt: number;

  constructor(bank: WordBank, engine: LearningEngine, rng: Rng, clock: () => number = Date.now) {
    this.bank = bank;
    this.engine = engine;
    this.rng = rng;
    this.clock = clock;
    this.startedAt = clock();
  }

  /** 다음 문제를 낸다 */
  next(): Quiz {
    this.pick = this.engine.next();
    this.quiz = generateQuiz(this.pick.word, this.bank, this.pick.type, this.rng, {
      isRetry: this.pick.isRetry || this.pick.category === 'session-review',
    });
    this.phase = 'quiz';
    this.asked++;
    this.shownAt = this.clock();
    return this.quiz;
  }

  private tierFor(combo: number): number {
    let index = 0;
    for (let i = 0; i < COMBO_TIERS.length; i++) {
      if (combo >= COMBO_TIERS[i].min) index = i;
    }
    return index;
  }

  answer(choiceIndex: number): AnswerResult {
    const quiz = this.quiz;
    const pick = this.pick;
    if (!quiz || !pick) throw new Error('출제된 문제가 없다');

    const word = this.bank.byId(quiz.wordId);
    const correct = isCorrect(quiz, choiceIndex, word);
    const wasRevive = this.phase === 'revive';

    // 풀이 시간 — 평균 문제 풀이 시간(PRD 30장)과 SPEED 능력치(16장)의 근거
    const answerMs = Math.min(30_000, this.clock() - this.shownAt);
    this.answerMsTotal += answerMs;
    const fast = answerMs <= FAST_ANSWER_MS;
    if (correct && fast) this.fastCorrect++;
    if (correct && quiz.difficulty >= HARD_DIFFICULTY) this.hardCorrect++;

    // 학습 상태 반영은 게임 규칙보다 먼저 — 결과에 mastered 를 실어 보내야 한다
    const learned = this.engine.record(pick, correct);
    if (quiz.isRetry) {
      this.retryTotal++;
      if (correct) this.retryCorrect++;
    }
    if (learned.mastered) this.masteredWords.push(quiz.word);

    const base = {
      correctIndex: quiz.correctIndex,
      mastered: learned.mastered,
      stage: learned.stage,
      word: quiz.word,
      difficulty: quiz.difficulty,
      fast,
      isRetry: quiz.isRetry,
    };

    if (correct) {
      this.correctCount++;
      this.combo++;
      this.bestCombo = Math.max(this.bestCombo, this.combo);

      const prevTier = this.tierIndex;
      this.tierIndex = this.tierFor(this.combo);
      const tier = COMBO_TIERS[this.tierIndex];

      this.score +=
        (quiz.isRetry ? RULES.scoreRetry : RULES.scoreBase) + this.combo * RULES.scoreComboBonus;

      if (wasRevive) {
        // 부활 — 방금 틀린 문제를 맞혔다. HP 를 1 회복하고 계속한다 (PRD 12장)
        this.hp = 1;
      }

      this.stepsLeft = tier.segment;
      this.phase = 'climbing';

      return {
        ...base,
        correct: true,
        segment: tier.segment,
        style: tier.style,
        tierUp: this.tierIndex > prevTier,
        comboLabel: tier.label,
        hp: this.hp,
        phase: this.phase,
      };
    }

    /* ── 오답 ── */
    this.wrongCount++;
    this.combo = 0;
    this.tierIndex = 0;
    this.wrongWords.add(quiz.word);

    if (wasRevive) {
      this.phase = 'over';
    } else {
      this.hp--;
      if (this.hp <= 0) {
        this.hp = 0;
        this.phase = 'revive';
      }
      // HP 가 남았으면 phase 는 'quiz' 그대로 — UI 가 피드백을 보여 준 뒤 next() 를 부른다
    }

    return {
      ...base,
      correct: false,
      segment: 0,
      style: 'normal',
      tierUp: false,
      comboLabel: '',
      hp: this.hp,
      phase: this.phase,
    };
  }

  /**
   * REVIVE 문제. 방금 틀린 **그 단어**를 다시 낸다 —
   * "이 단어만 다시 맞히면 계속할 수 있어" (PRD 25장)
   */
  reviveQuiz(): Quiz {
    const pick = this.pick;
    if (!pick) throw new Error('부활할 문제가 없다');
    // 방향을 바꿔 낸다. 같은 문제를 그대로 내면 보기 위치를 외워서 맞힌다
    const type = pick.type === 'EN_TO_KO' ? 'KO_TO_EN' : 'EN_TO_KO';
    this.pick = { ...pick, type, isRetry: true };
    this.quiz = generateQuiz(pick.word, this.bank, type, this.rng, { isRetry: true });
    this.phase = 'revive';
    this.shownAt = this.clock();
    return this.quiz;
  }

  /** 계단 한 칸을 올랐다 */
  stepClimbed(): { done: boolean } {
    if (this.phase !== 'climbing') return { done: false };
    this.stepsLeft = Math.max(0, this.stepsLeft - 1);
    return { done: this.stepsLeft === 0 };
  }

  get currentStyle(): StepStyle {
    return COMBO_TIERS[this.tierIndex].style;
  }

  stats(floor: number): SessionStats {
    return {
      asked: this.asked,
      correct: this.correctCount,
      wrong: this.wrongCount,
      accuracy: this.asked > 0 ? this.correctCount / this.asked : 0,
      bestCombo: this.bestCombo,
      score: this.score,
      floor,
      wrongWords: [...this.wrongWords],
      masteredWords: [...this.masteredWords],
    };
  }

  /** 누적 통계에 더할 이번 판 요약 */
  summary(floor: number): SessionSummary {
    return {
      questions: this.asked,
      correct: this.correctCount,
      wrong: this.wrongCount,
      answerMsTotal: this.answerMsTotal,
      bestCombo: this.bestCombo,
      playMs: this.clock() - this.startedAt,
      floor,
      retryCorrect: this.retryCorrect,
      retryTotal: this.retryTotal,
      fastCorrect: this.fastCorrect,
      hardCorrect: this.hardCorrect,
      masteredCount: this.masteredWords.length,
    };
  }

  /** 이어하기 — 중단된 판의 상태를 되돌린다 */
  restore(run: { hp: number; combo: number; score: number; asked: number; correct: number; wrong: number }) {
    this.hp = run.hp;
    this.combo = run.combo;
    this.bestCombo = Math.max(this.bestCombo, run.combo);
    this.tierIndex = this.tierFor(run.combo);
    this.score = run.score;
    this.asked = run.asked;
    this.correctCount = run.correct;
    this.wrongCount = run.wrong;
  }
}
