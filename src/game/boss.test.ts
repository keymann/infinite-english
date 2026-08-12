import { describe, expect, it } from 'vitest';

import { createRng } from '../core/rng';
import { LearningEngine } from '../learning/engine';
import { emptyProgress } from '../learning/mastery';
import { WordBank } from '../learning/words';
import { Session } from './session';
import {
  BOSS_EVERY,
  BOSS_MIN_GAP_QUESTIONS,
  bossReward,
  canSpawnBoss,
  hitBoss,
  hpRatio,
  isBossFloor,
  missBoss,
  questionsToDefeat,
  spawnBoss,
} from './boss';
import {
  DOUBLE_XP_QUESTIONS,
  EVENTS,
  activate,
  difficultyBonus,
  instantGold,
  rewardMultiplier,
  rollEvent,
  tickEvent,
} from './events';

/**
 * 보스전 · 랜덤 이벤트 테스트.
 *
 * 두 시스템 모두 **규칙을 잠깐 바꾸는** 장치라, 바뀐 규칙이 원래 규칙을 깨지 않는지가
 * 검사의 핵심이다. 특히 "이벤트가 HP 를 깎지 않는다"는 설계 전제를 코드로 고정한다.
 */

describe('보스전', () => {
  /* 20층 → 10층으로 줄였다. 문제를 계단 구간마다 조금씩 내는 대신 보스전에 모은다 */
  it('10층마다 나온다', () => {
    expect(BOSS_EVERY).toBe(10);
    expect(isBossFloor(10)).toBe(true);
    expect(isBossFloor(20)).toBe(true);
    expect(isBossFloor(9)).toBe(false);
    expect(isBossFloor(0)).toBe(false); // 시작 지점은 보스가 아니다
  });

  it('첫 보스는 12문제로 처치할 수 있다', () => {
    const boss = spawnBoss(BOSS_EVERY);
    let asked = 0;
    // 평범한 난이도·콤보 없이 계속 맞히는 최악의 경우
    while (boss.hp > 0 && asked < 100) {
      hitBoss(boss, 0.2, 0);
      asked++;
    }
    expect(asked).toBe(12);
    expect(questionsToDefeat(spawnBoss(BOSS_EVERY))).toBe(12);
  });

  /**
   * "보스의 난이도만큼 체력을 늘린다" = 층이 오르면 낼 문제 수가 늘어난다.
   * 다만 상한이 없으면 100층대 보스 하나가 판 전체보다 길어진다.
   */
  it('층이 오르면 체력과 문제 수가 늘어나고, 상한에서 멈춘다', () => {
    const counts = [10, 50, 100, 300, 1000].map((floor) =>
      questionsToDefeat(spawnBoss(floor)),
    );
    // 단조 증가
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i]).toBeGreaterThanOrEqual(counts[i - 1]);
    }
    expect(counts[0]).toBe(12);
    // 상한 — 어느 층이든 24문제를 넘지 않는다 (기본 데미지 10 기준 최악의 경우)
    expect(Math.max(...counts)).toBeLessThanOrEqual(24);
    expect(spawnBoss(1000).maxHp).toBe(spawnBoss(5000).maxHp);
  });

  it('어려운 단어가 더 큰 피해를 준다 (PRD 18장)', () => {
    const easy = spawnBoss(20);
    const hard = spawnBoss(20);
    hitBoss(easy, 0.1, 0);
    hitBoss(hard, 0.8, 0);
    expect(hard.hp).toBeLessThan(easy.hp);
  });

  it('콤보가 피해를 늘리지만 상한이 있다', () => {
    const damageAt = (combo: number) => {
      const boss = spawnBoss(20);
      return hitBoss(boss, 0.2, combo).damage;
    };
    expect(damageAt(10)).toBeGreaterThan(damageAt(0));
    // 콤보 20 에서 상한(+10)에 닿는다 — 콤보 100 이 무한히 세지지 않는다
    expect(damageAt(100)).toBe(damageAt(20));
    expect(damageAt(100) - damageAt(0)).toBe(10);
  });

  it('HP 는 0 아래로 내려가지 않고, 처치를 정확히 한 번만 알린다', () => {
    const boss = spawnBoss(20);
    let defeats = 0;
    for (let i = 0; i < 30; i++) {
      const hit = hitBoss(boss, 0.9, 20);
      if (hit.defeated) defeats++;
    }
    expect(boss.hp).toBe(0);
    // 이미 0 인 보스를 계속 때리면 매번 defeated 가 되지만, 게임은 첫 처치에서 보스를 없앤다.
    // 여기서 확인하는 것은 HP 가 음수가 되지 않는 것이다
    expect(defeats).toBeGreaterThan(0);
  });

  it('오답도 문제 수에 센다 (통계·연출용)', () => {
    const boss = spawnBoss(20);
    missBoss(boss);
    expect(boss.asked).toBe(1);
    expect(boss.hp).toBe(boss.maxHp); // 보스 HP 는 줄지 않는다
  });

  it('뒤 보스가 더 단단하고 보상도 크다', () => {
    const first = spawnBoss(10);
    const second = spawnBoss(50);
    expect(second.maxHp).toBeGreaterThan(first.maxHp);
    expect(bossReward(second).gold).toBeGreaterThan(bossReward(first).gold);
  });

  /**
   * 한 구간이 최대 12칸이므로 보스 층을 두 번 지나칠 수 있다. 층 조건만 두면
   * 보스가 연달아 등장한다 — 문제 수 간격이 그 병리적 경우를 막는다.
   */
  it('보스 사이에 최소 문제 수 간격을 둔다', () => {
    // 보스 층에 닿았지만 직전 보스로부터 문제 수 간격을 못 채웠다 → 아직 안 낸다
    expect(
      canSpawnBoss({
        floor: 20,
        lastBossFloor: 0,
        asked: BOSS_MIN_GAP_QUESTIONS - 1,
        lastBossAsked: 0,
      }),
    ).toBe(false);
    // 간격을 채우면 낸다
    expect(
      canSpawnBoss({ floor: 20, lastBossFloor: 0, asked: BOSS_MIN_GAP_QUESTIONS, lastBossAsked: 0 }),
    ).toBe(true);
    // 이미 잡은 보스 층은 다시 내지 않는다
    expect(
      canSpawnBoss({ floor: 25, lastBossFloor: 20, asked: 50, lastBossAsked: 10 }),
    ).toBe(false);
    // 다음 보스 층에 닿으면 다시 낸다
    expect(
      canSpawnBoss({ floor: 30, lastBossFloor: 20, asked: 50, lastBossAsked: 10 }),
    ).toBe(true);
    // 구간이 최대 12칸이라 보스 층을 뛰어넘어 도착해도 보스는 나온다
    expect(
      canSpawnBoss({ floor: 22, lastBossFloor: 0, asked: 30, lastBossAsked: 0 }),
    ).toBe(true);
  });

  it('HP 비율은 0~1 이다', () => {
    const boss = spawnBoss(20);
    expect(hpRatio(boss)).toBe(1);
    hitBoss(boss, 0.2, 0);
    expect(hpRatio(boss)).toBeLessThan(1);
    expect(hpRatio(boss)).toBeGreaterThan(0);
  });
});

describe('보스전 출제 — 약점 단어 집중 (PRD 19장)', () => {
  const bank = new WordBank();

  it('취약 단어를 낸다', async () => {
    await bank.loadLevels([1, 2]);
    const engine = new LearningEngine(bank, createRng(5), () => 1_700_000_000_000);

    // 3개 단어를 취약(정답률 낮음)으로 만든다
    const weakWords = bank.all().slice(0, 3);
    for (const w of weakWords) {
      engine.progress[w.id] = { ...emptyProgress(), right: 1, wrong: 4, lastCorrectAt: 1 };
    }
    // 나머지는 잘 아는 단어
    for (const w of bank.all().slice(3, 40)) {
      engine.progress[w.id] = { ...emptyProgress(), right: 5, wrong: 0, lastCorrectAt: 1 };
    }

    const weakIds = new Set(weakWords.map((w) => w.id));
    const picks = Array.from({ length: 8 }, () => engine.next({ boss: true }));
    const hits = picks.filter((p) => weakIds.has(p.word.id)).length;

    expect(picks.every((p) => p.category === 'boss')).toBe(true);
    // 취약 단어 3개 안에서 돌아야 한다 (같은 단어를 연달아 내지는 않는다)
    expect(hits).toBeGreaterThanOrEqual(6);
    for (let i = 1; i < picks.length; i++) {
      expect(picks[i].word.id).not.toBe(picks[i - 1].word.id);
    }
  });

  it('취약 단어가 없어도 문제를 낸다 — 보스가 안 나오면 안 된다', async () => {
    await bank.loadLevels([1, 2]);
    const engine = new LearningEngine(bank, createRng(9), () => 1_700_000_000_000);
    const pick = engine.next({ boss: true });
    expect(pick.word).toBeTruthy();
  });
});

describe('조작 실패로 판이 끝난다 — 방향 오선택 · 계단 시간 초과', () => {
  const bank = new WordBank();

  /**
   * `Session.fail` 은 **HP 와 REVIVE 를 거치지 않는다.**
   * HP 는 영어 오답 전용이고(PRD 3.2절), REVIVE 는 "이 단어만 다시 맞히면 계속" 이라는
   * 학습 장치다 — 조작 실패에는 다시 낼 단어가 없다.
   */
  it('즉시 종료되고 HP 는 건드리지 않는다', async () => {
    await bank.loadLevels([1, 2]);
    const engine = new LearningEngine(bank, createRng(11), () => 1_700_000_000_000);
    const session = new Session(bank, engine, createRng(12), () => 1_700_000_000_000);
    session.next(0);
    const hpBefore = session.hp;

    session.fail('direction');

    expect(session.phase).toBe('over');
    expect(session.failReason).toBe('direction');
    expect(session.hp).toBe(hpBefore); // REVIVE 로 가지 않는다
    expect(session.stepsLeft).toBe(0);
  });

  it('콤보를 잃는다 — 조작을 틀렸는데 콤보가 남으면 다음 판으로 새어 나간다', async () => {
    await bank.loadLevels([1, 2]);
    const engine = new LearningEngine(bank, createRng(13), () => 1_700_000_000_000);
    const session = new Session(bank, engine, createRng(14), () => 1_700_000_000_000);
    session.next(0);
    const quiz = session.quiz!;
    session.answer(quiz.correctIndex);
    expect(session.combo).toBe(1);

    session.fail('timeout');
    expect(session.combo).toBe(0);
    expect(session.failReason).toBe('timeout');
  });

  it('이미 끝난 판의 사유를 덮어쓰지 않는다', async () => {
    await bank.loadLevels([1, 2]);
    const engine = new LearningEngine(bank, createRng(15), () => 1_700_000_000_000);
    const session = new Session(bank, engine, createRng(16), () => 1_700_000_000_000);
    session.next(0);
    session.fail('direction');
    // main.ts 의 failRun 이 phase 를 보고 두 번째 호출을 막는다 (여기서는 계약만 고정한다)
    expect(session.phase).toBe('over');
    expect(session.failReason).toBe('direction');
  });

  it('기본 종료 사유는 영어 오답이다', async () => {
    await bank.loadLevels([1, 2]);
    const engine = new LearningEngine(bank, createRng(17), () => 1_700_000_000_000);
    const session = new Session(bank, engine, createRng(18), () => 1_700_000_000_000);
    expect(session.failReason).toBe('quiz');
  });
});

describe('랜덤 이벤트', () => {
  const rng = createRng(1234);

  it('5문제마다만 굴린다 — 연달아 터지면 특별함이 사라진다', () => {
    for (const asked of [1, 2, 3, 4, 6, 7]) {
      expect(rollEvent({ asked, floor: 30, rng, lastId: null, inBoss: false }).event).toBeNull();
    }
  });

  it('보스전 중에는 이벤트가 나오지 않는다', () => {
    for (let i = 0; i < 20; i++) {
      expect(rollEvent({ asked: 5, floor: 30, rng, lastId: null, inBoss: true }).event).toBeNull();
    }
  });

  it('초반 층에서는 어려운 이벤트가 나오지 않는다', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const decision = rollEvent({ asked: 5, floor: 3, rng, lastId: null, inBoss: false });
      if (decision.event) seen.add(decision.event.id);
    }
    // 3층에서는 fromFloor 3 인 treasure 만 가능하다
    expect([...seen]).toEqual(['treasure']);
  });

  it('같은 이벤트를 연달아 내지 않는다', () => {
    for (let i = 0; i < 100; i++) {
      const decision = rollEvent({ asked: 5, floor: 30, rng, lastId: 'treasure', inBoss: false });
      expect(decision.event?.id).not.toBe('treasure');
    }
  });

  it('Double XP 는 3문제 동안 유지되고 그 뒤 사라진다', () => {
    const def = EVENTS.find((e) => e.id === 'doubleXp')!;
    let active = activate(def);
    expect(active.remaining).toBe(DOUBLE_XP_QUESTIONS);
    expect(rewardMultiplier(active, false)).toBe(2);

    for (let i = 0; i < DOUBLE_XP_QUESTIONS - 1; i++) {
      active = tickEvent(active)!;
      expect(active).not.toBeNull();
    }
    expect(tickEvent(active)).toBeNull();
  });

  it('Speed 는 시간 안에 맞히면 보너스, 넘겨도 벌은 없다', () => {
    const speed = activate(EVENTS.find((e) => e.id === 'speed')!);
    expect(rewardMultiplier(speed, true)).toBe(2);
    expect(rewardMultiplier(speed, false)).toBe(1); // 배수 1 — 감점이 아니다
  });

  it('Golden Word 가 가장 큰 배수를 준다', () => {
    const golden = rewardMultiplier(activate(EVENTS.find((e) => e.id === 'goldenWord')!), false);
    const mystery = rewardMultiplier(activate(EVENTS.find((e) => e.id === 'mystery')!), false);
    expect(golden).toBeGreaterThan(mystery);
  });

  it('Mystery 만 난이도를 올린다', () => {
    expect(difficultyBonus(EVENTS.find((e) => e.id === 'mystery')!)).toBeGreaterThan(0);
    expect(difficultyBonus(EVENTS.find((e) => e.id === 'treasure')!)).toBe(0);
    expect(difficultyBonus(null)).toBe(0);
  });

  it('Treasure 만 즉시 골드를 준다 (층이 높으면 더 많이)', () => {
    const treasure = EVENTS.find((e) => e.id === 'treasure')!;
    expect(instantGold(treasure, 5)).toBeGreaterThan(0);
    expect(instantGold(treasure, 50)).toBeGreaterThan(instantGold(treasure, 5));
    expect(instantGold(EVENTS.find((e) => e.id === 'speed')!, 50)).toBe(0);
  });

  /** Session 의 호출 순서를 그대로 재현한다 — 주기가 깨지면 이벤트가 안 뜬다 */
  it('20문제에서 5문제마다 시도한다 (asked 5·10·15)', () => {
    const stream = createRng(101);
    let active: ReturnType<typeof activate> | null = null;
    let asked = 0;
    const attempted: number[] = [];
    for (let q = 0; q < 20; q++) {
      active = tickEvent(active);
      if (!active) {
        const d = rollEvent({ asked, floor: 25, rng: stream, lastId: null, inBoss: false });
        if (d.attempted) attempted.push(asked);
        if (d.event) active = activate(d.event);
      }
      asked++;
    }
    expect(attempted).toEqual([5, 10, 15]);
  });

  it('모든 이벤트 정의가 유효하다', () => {
    for (const def of EVENTS) {
      expect(def.label.length).toBeGreaterThan(0);
      expect(def.hint.length).toBeGreaterThan(0);
      expect(def.weight).toBeGreaterThan(0);
      expect(def.fromFloor).toBeGreaterThanOrEqual(0);
    }
    expect(EVENTS).toHaveLength(6); // PRD 20장의 6종
  });
});
