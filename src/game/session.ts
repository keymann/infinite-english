import type { Rng } from '../core/rng';
import type { LearningEngine, Pick } from '../learning/engine';
import type { WordBank } from '../learning/words';
import { generateQuiz, isCorrect } from '../quiz/generator';
import type { Quiz } from '../quiz/types';
import type { SessionSummary } from '../progress/stats';
import { FAST_ANSWER_MS, HARD_DIFFICULTY } from '../progress/player';
import { COMBO_TIERS, RULES, type StepStyle } from './balance';
import { hitBoss, missBoss, spawnBoss, type BossHit, type BossState } from './boss';
import {
  SPEED_LIMIT_SEC,
  activate,
  difficultyBonus,
  rewardMultiplier,
  rollEvent,
  tickEvent,
  type ActiveEvent,
  type EventDef,
  type EventId,
} from './events';

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

/**
 * 판이 끝난 이유. 종료 화면의 문구가 달라진다 — 아이가 "무엇 때문에 끝났는지"를
 * 알아야 다음 판에 고칠 수 있다.
 */
export type FailReason = 'quiz' | 'direction' | 'timeout';

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
  /** 이벤트 보상 배수 — main 이 경험치·골드에 곱한다 */
  multiplier: number;
  /** 보스전이었다면 타격 결과 */
  bossHit: BossHit | null;
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
  /** 보스전 중이면 보스 상태 (PRD 18장) */
  boss: BossState | null = null;
  /** 이번 문제에 붙은 이벤트 (PRD 20장) */
  event: ActiveEvent | null = null;
  /** 방금 새로 발생한 이벤트 — UI 가 배너를 띄운 뒤 비운다 */
  pendingEvent: EventDef | null = null;
  /** 판이 끝난 이유. 기본값은 영어 오답(REVIVE 실패) */
  failReason: FailReason = 'quiz';

  private readonly bank: WordBank;
  private readonly engine: LearningEngine;
  private readonly rng: Rng;
  private readonly clock: () => number;
  private readonly wrongWords = new Set<string>();
  private readonly masteredWords: string[] = [];
  private tierIndex = 0;
  private pick: Pick | null = null;
  private lastEventId: EventId | null = null;
  private currentFloor = 0;
  /** 이벤트 판정 계측 — 왜 안 뜨는지 확인할 수 있어야 한다 */
  eventRolls = 0;
  eventsFired = 0;
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

  /**
   * 다음 문제를 낸다.
   *
   * 층을 인자로 받는 이유: 이벤트 발생 확률과 종류가 층에 따라 달라진다 (PRD 20장).
   * Session 이 계단 상태를 들고 있지 않으므로 호출하는 쪽이 알려 준다.
   */
  next(floor = this.currentFloor): Quiz {
    this.currentFloor = floor;

    // 지속형 이벤트(Double XP)의 남은 문제 수를 깎는다
    this.event = tickEvent(this.event);

    // 이벤트 판정 — 보스전 중에는 굴리지 않는다
    if (!this.event) {
      const decision = rollEvent({
        asked: this.asked,
        floor,
        rng: this.rng,
        lastId: this.lastEventId,
        inBoss: this.boss !== null,
      });
      if (decision.attempted) this.eventRolls++;
      if (decision.event) {
        this.eventsFired++;
        this.event = activate(decision.event);
        this.pendingEvent = decision.event;
        this.lastEventId = decision.event.id;
      }
    }

    this.pick = this.engine.next({
      boss: this.boss !== null,
      difficultyBonus: difficultyBonus(this.event?.def ?? null),
    });
    this.quiz = generateQuiz(this.pick.word, this.bank, this.pick.type, this.rng, {
      isRetry: this.pick.isRetry || this.pick.category === 'session-review',
    });
    this.phase = 'quiz';
    this.asked++;
    this.shownAt = this.clock();
    return this.quiz;
  }

  /** 보스 등장 — 계단은 잠기고 정답이 보스 HP 를 깎는다 */
  startBoss(floor: number): BossState {
    this.boss = spawnBoss(floor);
    this.stepsLeft = 0;
    this.event = null;
    return this.boss;
  }

  /** Escape 이벤트 등에서 콤보만 잃는다 — HP 는 영어 오답 전용이다 */
  breakCombo() {
    this.combo = 0;
    this.tierIndex = 0;
  }

  /**
   * 계단 조작 실패로 판을 끝낸다 — **방향 오선택** 또는 **계단 타이머 만료**.
   *
   * HP 와 REVIVE 를 거치지 않는다. HP 는 영어 오답 전용이고(PRD 3.2절), REVIVE 는
   * "이 단어만 다시 맞히면 계속" 이라는 학습 장치다 — 조작 실패에는 다시 낼 단어가 없다.
   * 그래서 즉시 종료다.
   */
  fail(reason: FailReason): void {
    this.failReason = reason;
    this.phase = 'over';
    this.combo = 0;
    this.tierIndex = 0;
    this.stepsLeft = 0;
    this.quiz = null;
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
    // Speed 이벤트는 별도 기준(5초)을 쓴다
    const inSpeedLimit = answerMs <= SPEED_LIMIT_SEC * 1000;
    const multiplier = correct ? rewardMultiplier(this.event, inSpeedLimit) : 1;
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
      multiplier,
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

      /* 보스전: 계단이 열리지 않는다. 정답이 보스 HP 를 깎고, 처치하면 계단이 다시 열린다.
         같은 문제를 푸는데 의미가 달라지는 구간이다 (PRD 18장). */
      if (this.boss) {
        const hit = hitBoss(this.boss, quiz.difficulty, this.combo);
        if (hit.defeated) {
          this.boss = null;
          this.stepsLeft = tier.segment;
          this.phase = 'climbing';
        } else {
          this.phase = 'quiz';
        }
        return {
          ...base,
          correct: true,
          segment: hit.defeated ? tier.segment : 0,
          style: tier.style,
          tierUp: this.tierIndex > prevTier,
          comboLabel: tier.label,
          hp: this.hp,
          phase: this.phase,
          bossHit: hit,
        };
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
        bossHit: null,
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

    if (this.boss) missBoss(this.boss);

    return {
      ...base,
      correct: false,
      segment: 0,
      style: 'normal',
      tierUp: false,
      comboLabel: '',
      hp: this.hp,
      phase: this.phase,
      bossHit: null,
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
