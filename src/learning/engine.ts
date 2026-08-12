import type { Rng } from '../core/rng';
import type { QuizType } from '../quiz/types';
import {
  calibrationTarget,
  initialAbility,
  isCalibrating,
  levelToUnit,
  targetLevelRange,
  updateAbility,
  type Ability,
} from './adaptive';
import {
  emptyProgress,
  isMastered,
  recordCorrect,
  recordWrong,
  type WordProgress,
} from './mastery';
import { inBand } from './gradeBand';
import { ReviewQueue, isNew, progressOf, scheduleNext } from './review';
import { isWeak, weakWords } from './weak';
import type { Word, WordBank } from './words';

/**
 * Learning Engine — 무엇을 낼지 정하고, 결과를 학습 상태에 반영한다.
 *
 * Phase 2 의 `selector.ts`(잠정판)를 대체한다. PRD 8·10·24장을 여기서 지킨다.
 *
 *  1. **출제 비율** 신규 50 / 복습 30 / 취약 15 / 보너스 5 — 20문항 자루(bag)로 정확히 맞춘다
 *  2. **세션 내 복습이 최우선** — 30초 전에 틀린 단어가 예정 시각에 닿으면 비율을 무시하고 낸다
 *  3. **파도형 난이도** — 어려운 문제를 연속해서 내지 않는다
 *  4. **개인별 난이도** — theta 로 목표 밴드를 잡고 그 안에서 고른다
 *  5. **Mastery 게이트를 향해 유형을 고른다** — 아직 안 맞힌 방향을 먼저 낸다
 *
 * three·DOM 을 import 하지 않는다. 시뮬레이터(Node)와 단위 테스트에서 그대로 돌아야 한다.
 * 시간도 주입받는다(`clock`) — "하루 뒤 재출제"를 테스트에서 검증해야 한다.
 */

export type PickCategory = 'new' | 'review' | 'weak' | 'bonus' | 'session-review' | 'boss';

export type PickOptions = {
  /**
   * 보스전 — **자주 틀리는 단어를 집중 출제한다** (PRD 19장).
   * 보스전이 곧 약점 복습 구간이 되도록 한 설계다. 아이는 보스를 잡으려고
   * 자기가 약한 단어를 반복한다.
   */
  boss?: boolean;
  /** 이벤트가 난이도를 올릴 때 (Mystery) */
  difficultyBonus?: number;
};

export type Pick = {
  word: Word;
  type: QuizType;
  category: PickCategory;
  /** 복습·취약·세션복습이면 true — 점수를 절반만 준다 */
  isRetry: boolean;
};

/** 판을 넘어 남는 학습 상태 — 조회용(항상 채워져 있다) */
export type LearningState = {
  ability: Ability;
  progress: Record<string, WordProgress>;
};

/**
 * 엔진 생성 입력 — **전부 선택이다.** 없으면 기본값에서 시작한다.
 *
 * 조회용 `LearningState` 와 나눠 둔다. 하나로 합쳐 필드를 선택으로 만들면
 * `engine.state` 를 쓰는 쪽이 매번 `?.` 를 붙여야 한다.
 */
export type EngineInit = Partial<LearningState> & {
  /**
   * 로비에서 고른 문제 레벨 (learning/gradeBand.ts).
   *
   * adaptive 를 대체하지 않고 **그 위에 씌우는 제한**이다. null 이면 제한 없음.
   */
  levels?: readonly number[] | null;
};

/** 20문항 기준 자루 — 신규 10 · 복습 6 · 취약 3 · 보너스 1 (PRD 8장) */
const MIX_BAG: PickCategory[] = [
  ...Array(10).fill('new'),
  ...Array(6).fill('review'),
  ...Array(3).fill('weak'),
  ...Array(1).fill('bonus'),
];

/**
 * 보스전 자루 — 신규 8 · 복습 5 · 취약 6 · 보너스 1.
 *
 * **보스전이 유일한 학습 창구가 되면서 필요해진 자루다.** 이전에는 보스전에서
 * 취약 단어만 냈다(`pickWord('weak')` 고정). 계단 구간에도 문제가 있었으니 그쪽이
 * 신규 단어를 담당했다.
 *
 * 문제를 보스전에서만 내게 되자 그 구조가 **신규 단어를 영원히 내지 않는 상태**가 됐다 —
 * 아이가 아는 단어만 반복하고 어휘가 늘지 않는다. 게임 요청이 학습 목적을 무너뜨리면
 * 안 되므로, 보스전이 전체 커리큘럼을 지고 가게 바꿨다.
 *
 * 그래도 **취약 비중은 15% → 30% 로 두 배다** — "보스는 약점을 집중 출제한다"(PRD 19장)는
 * 성격은 유지된다.
 */
const BOSS_BAG: PickCategory[] = [
  ...Array(8).fill('new'),
  ...Array(5).fill('review'),
  ...Array(6).fill('weak'),
  ...Array(1).fill('bonus'),
];

/**
 * 파도형 난이도 곡선 (PRD 24장). 목표 난이도에 더하는 보정값 — **레벨 단위**다.
 * 쉬움 → 쉬움 → 보통 → 쉬움 → 어려움 → 보통 → … 처럼 오르내린다.
 * 0.6레벨이면 정답 확률로 약 12%p 차이다 — 체감되지만 무너지지는 않는 폭.
 */
const WAVE_LEVELS = [-0.5, -0.5, 0, -0.35, 0.6, 0, 0.1, -0.7, 0.6, 0.2] as const;
/** 이 값을 넘는 보정은 "어려운 문제"로 본다 — 연속 금지 대상 */
const HARD_OFFSET_LEVELS = 0.4;

/** 직전 몇 문제에 나온 단어를 제외할지 */
const RECENT_WINDOW = 6;

export class LearningEngine {
  readonly review = new ReviewQueue();
  ability: Ability;
  progress: Record<string, WordProgress>;

  private readonly bank: WordBank;
  private readonly rng: Rng;
  private readonly clock: () => number;
  private readonly recent: string[] = [];
  /** 출제 가능한 레벨 — 로비 선택. null 이면 제한 없음 */
  private levels: readonly number[] | null;
  /** 직전에 낸 단어 — 후보가 좁아도 **연속 출제는 막는다** */
  private lastPickedId: string | null = null;
  private bag: PickCategory[] = [];
  /** 보스전 자루를 쓰는지 — 보스전에서만 문제가 나오므로 사실상 항상 true 가 된다 */
  private useBossBag = false;
  private asked = 0;
  /** 이번 문항에만 적용되는 난이도 가산 (Mystery 이벤트) */
  private difficultyBonus = 0;
  private lastWasHard = false;
  /** 이번 판에서 낸 문제 기록 — 통계용 */
  private readonly log: Array<{ wordId: string; category: PickCategory; correct: boolean }> = [];

  constructor(bank: WordBank, rng: Rng, clock: () => number, state?: EngineInit) {
    this.bank = bank;
    this.rng = rng;
    this.clock = clock;
    this.ability = state?.ability ?? initialAbility();
    this.progress = state?.progress ?? {};
    this.levels = state?.levels ?? null;
  }

  /** 로비에서 레벨 구간을 바꿨다 — 판 도중에는 호출되지 않는다 */
  setLevels(levels: readonly number[] | null) {
    this.levels = levels;
  }

  /* ── 출제 ── */

  next(options: PickOptions = {}): Pick {
    const now = this.clock();
    this.asked++;
    this.difficultyBonus = options.difficultyBonus ?? 0;

    /* 보스전도 비율 자루를 쓴다 — 취약 비중만 두 배인 별도 자루(BOSS_BAG).
       세션 내 복습(아래 1번)은 보스전에서도 그대로 최우선이다: 방금 틀린 단어를
       30초 뒤에 다시 만나는 것이 보스전에서 특히 자연스럽다 */
    if (options.boss) this.useBossBag = true;

    // 1. 세션 내 복습이 최우선 — "30초 후 재출제"는 비율보다 앞선다 (PRD 10장)
    const dueId = this.review.dueNow(now);
    if (dueId) {
      const word = this.bank.byId(dueId);
      if (word) {
        this.remember(word.id);
        return { word, type: this.typeFor(word), category: 'session-review', isRetry: true };
      }
    }

    // 2. 자루에서 카테고리를 뽑는다 (비율 보장)
    const category = this.drawCategory();
    const word = this.pickWord(category, now);
    this.remember(word.id);
    return {
      word,
      type: this.typeFor(word),
      category,
      isRetry: category === 'review' || category === 'weak',
    };
  }

  private drawCategory(): PickCategory {
    if (this.bag.length === 0) {
      // 자루를 채워 섞는다 — 매번 확률로 뽑으면 20문항에서 비율이 맞지 않는다
      this.bag = (this.useBossBag ? BOSS_BAG : MIX_BAG).slice();
      for (let i = this.bag.length - 1; i > 0; i--) {
        const j = Math.floor(this.rng() * (i + 1));
        [this.bag[i], this.bag[j]] = [this.bag[j], this.bag[i]];
      }
    }
    return this.bag.pop()!;
  }

  /** 이번 문항의 목표 난이도(0~1) */
  private targetDifficulty(): number {
    if (isCalibrating(this.ability)) {
      // Calibration 은 정해진 파형으로 — 쉬움·보통·어려움을 섞어 위치를 빨리 잡는다.
      // 절대 난이도가 아니라 **현재 추정 실력 기준의 상대값**이다 (adaptive.ts 주석 참고)
      return calibrationTarget(this.ability.theta, this.ability.answered);
    }
    const band = targetLevelRange(this.ability.theta);
    const midLevel = (band.min + band.max) / 2;

    let offset = WAVE_LEVELS[(this.asked - 1) % WAVE_LEVELS.length];
    // 어려운 문제를 연속해서 내지 않는다 (PRD 24장)
    if (offset > HARD_OFFSET_LEVELS && this.lastWasHard) offset = 0;
    this.lastWasHard = offset > HARD_OFFSET_LEVELS;

    return Math.min(0.98, levelToUnit(midLevel + offset) + this.difficultyBonus);
  }

  private pickWord(category: PickCategory, now: number): Word {
    const candidates = this.candidatesFor(category, now);
    const usable = candidates.filter((w) => !this.recent.includes(w.id));
    let pool = usable.length > 0 ? usable : candidates;

    /* 복습·취약 후보가 실력보다 훨씬 어려우면 지금 내지 않는다.
       초3 수준 아이가 어쩌다 만난 중등 단어를 계속 되돌려 받으면 정답률이 무너지고
       (시뮬레이션에서 48%), 그 단어는 영원히 취약 목록에 남는다. 실력이 오른 뒤에 다시 만난다. */
    if (category === 'review' || category === 'weak') {
      // 목표보다 0.7레벨까지만 허용한다 (unit 으로 약 +0.08)
      const ceiling = this.targetDifficulty() + 0.7 / (10 - 1);
      const reachable = pool.filter((w) => w.difficulty <= ceiling);
      if (reachable.length > 0) pool = reachable;
    }

    if (pool.length === 0) {
      // 어떤 카테고리도 비면 신규로 떨어진다. 게임이 멈추면 안 된다
      const any = inBand(this.bank.all(), this.levels);
      return this.pickClosest(any.filter((w) => !this.recent.includes(w.id)));
    }

    /* 후보가 아주 좁을 때(보스전의 취약 단어 3개 같은 경우) recent 필터가 다 걸러져
       fallback 으로 내려오면 **직전 단어가 다시 뽑힐 수 있다.** 연속 출제는 금지다
       (PRD 19장 "같은 단어를 지나치게 반복하지 않는다") — 최소한 바로 다음은 피한다. */
    if (pool.length > 1 && this.lastPickedId) {
      const notLast = pool.filter((w) => w.id !== this.lastPickedId);
      if (notLast.length > 0) pool = notLast;
    }
    return this.pickClosest(pool);
  }

  /** 목표 난이도에 가장 가까운 단어. 동점은 난수로 흔들어 매번 같은 단어가 나오지 않게 한다 */
  private pickClosest(pool: readonly Word[]): Word {
    const target = this.targetDifficulty();
    const scored = pool.map((w) => ({
      word: w,
      gap: Math.abs(w.difficulty - target) + this.rng() * 0.04,
    }));
    scored.sort((a, b) => a.gap - b.gap);
    return scored[0].word;
  }

  private candidatesFor(category: PickCategory, now: number): Word[] {
    // 고른 학년 구간 안에서만 고른다 (비면 전체로 되돌아간다 — gradeBand.inBand)
    const all = inBand(this.bank.all(), this.levels);
    switch (category) {
      case 'new':
        return all.filter((w) => isNew(this.progress, w.id));
      case 'review':
        // 세션 간 큐가 찬 단어 → 없으면 "만났지만 아직 Mastered 가 아닌" 단어
        return all.filter((w) => {
          const p = this.progress[w.id];
          if (!p || (p.right === 0 && p.wrong === 0)) return false;
          if (isMastered(p)) return false;
          return p.dueAt === 0 || p.dueAt <= now;
        });
      case 'weak': {
        const ids = new Set(weakWords(this.progress));
        const weak = all.filter((w) => ids.has(w.id));
        if (weak.length > 0) return weak;
        // 아직 취약 단어가 없다 → 만난 적 있는 단어(복습)로 떨어진다
        return this.candidatesFor('review', now);
      }
      case 'bonus':
        // 보너스는 **쉬운 성공 경험**이다. 이미 잘 아는 단어를 낸다
        return all.filter((w) => {
          const p = this.progress[w.id];
          return !!p && (isMastered(p) || (p.right >= 2 && p.wrong === 0));
        });
      case 'boss':
      case 'session-review':
        return [];
    }
  }

  /**
   * 문제 유형 선택 — Mastery 게이트를 향해 고른다.
   * 아직 못 맞힌 방향이 있으면 그것을 먼저 낸다. 같은 방향만 계속 내면
   * 정답률은 올라가지만 Mastered 는 영원히 되지 않는다.
   */
  private typeFor(word: Word): QuizType {
    const p = this.progress[word.id];
    if (p) {
      const hasEnKo = p.clearedTypes.includes('EN_TO_KO');
      const hasKoEn = p.clearedTypes.includes('KO_TO_EN');
      /* **Mastery 게이트가 그림 문제보다 우선한다.** 아직 못 맞힌 방향이 있으면 그것을 낸다 —
         그림 문제가 이 슬롯을 가로채면 그림이 있는 단어(14개)만 마스터가 계속 늦어진다.
         단위 테스트가 이 충돌을 잡았다. */
      if (hasEnKo && !hasKoEn) return 'KO_TO_EN';
      if (!hasEnKo && hasKoEn) return 'EN_TO_KO';

      /* 두 방향을 다 맞힌 뒤에는 그림 문제를 섞는다 (PRD 2장 TYPE_C).
         뜻을 한 번도 안 본 단어에 그림부터 내면 찍기가 된다. */
      if (word.imageAsset && hasEnKo && hasKoEn && this.rng() < 0.4) return 'IMAGE_TO_EN';
    }
    // 처음 만나는 단어는 EN→KO 를 더 자주 낸다 (뜻을 먼저 익히는 게 순서다)
    return this.rng() < 0.65 ? 'EN_TO_KO' : 'KO_TO_EN';
  }

  private remember(wordId: string) {
    this.lastPickedId = wordId;
    this.recent.push(wordId);
    if (this.recent.length > RECENT_WINDOW) this.recent.shift();
  }

  /* ── 채점 반영 ── */

  record(pick: Pick, correct: boolean): { mastered: boolean; stage: number } {
    const now = this.clock();
    const word = pick.word;
    const before = progressOf(this.progress, word.id);
    const wasMastered = isMastered(before);

    let after = correct ? recordCorrect(before, pick.type, now) : recordWrong(before);
    after = scheduleNext(after, correct, now);
    this.progress[word.id] = after;

    if (correct) this.review.clearSession(word.id);
    else this.review.pushWrong(word.id, now);

    this.ability = updateAbility(
      this.ability,
      word.difficulty,
      correct,
      isCalibrating(this.ability),
    );

    this.log.push({ wordId: word.id, category: pick.category, correct });

    return { mastered: !wasMastered && isMastered(after), stage: after.stage };
  }

  /* ── 조회 ── */

  get state(): LearningState {
    return { ability: this.ability, progress: this.progress };
  }

  progressFor(wordId: string): WordProgress {
    return progressOf(this.progress, wordId);
  }

  /** 이번 판의 카테고리 분포 — 비율이 실제로 지켜졌는지 확인용 */
  categoryCounts(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const entry of this.log) counts[entry.category] = (counts[entry.category] ?? 0) + 1;
    return counts;
  }

  summary() {
    const values = Object.values(this.progress);
    return {
      seen: values.length,
      mastered: values.filter((p) => isMastered(p)).length,
      weak: values.filter((p) => isWeak(p)).length,
      theta: +this.ability.theta.toFixed(2),
      confidence: +this.ability.confidence.toFixed(2),
      calibrating: isCalibrating(this.ability),
      pendingSessionReview: this.review.sessionSize,
    };
  }

  endSession() {
    this.review.endSession();
  }
}

export { emptyProgress };
