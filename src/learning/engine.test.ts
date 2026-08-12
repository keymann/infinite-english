import { describe, expect, it } from 'vitest';

import { createRng } from '../core/rng';
import { CALIBRATION_COUNT, initialAbility, targetDifficultyRange, updateAbility } from './adaptive';
import { LearningEngine } from './engine';
import {
  MASTERY_DELAY_MS,
  emptyProgress,
  isMastered,
  recordCorrect,
  recordWrong,
} from './mastery';
import { ReviewQueue, scheduleNext } from './review';
import { isWeak } from './weak';
import { WordBank } from './words';

/**
 * 학습 엔진 테스트.
 *
 * 이 모듈들은 **눈으로 검증할 수 없다.** "하루 뒤에 다시 나오는가", "20문항의 출제 비율이
 * 맞는가", "난이도가 급변하지 않는가"는 화면을 봐서는 알 수 없다.
 * 그래서 시간(`clock`)과 난수(`rng`)를 전부 주입받게 만들었다.
 */

/** 운영과 같은 범위 (초3~중3, 1,000개) — adaptive 밴드가 L6~10 까지 보고 고른다 */
const bank = new WordBank();
await bank.loadLevels([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

/** 조작 가능한 시계 */
function fakeClock(start = 1_700_000_000_000) {
  let now = start;
  return {
    now: () => now,
    advance(ms: number) {
      now += ms;
    },
  };
}

describe('Mastery — 한 번 맞혔다고 Mastered 가 아니다', () => {
  it('같은 유형만 반복해서 맞혀도 100% 가 되지 않는다', () => {
    const clock = fakeClock();
    let p = emptyProgress();
    for (let i = 0; i < 10; i++) {
      p = recordCorrect(p, 'EN_TO_KO', clock.now());
      clock.advance(MASTERY_DELAY_MS * 2); // 시간도 충분히 흐르게 한다
    }
    expect(p.right).toBe(10);
    expect(isMastered(p)).toBe(false); // KO→EN 을 못 맞혔다
    expect(p.stage).toBe(4);
  });

  it('두 방향 + 하루 뒤 재정답을 모두 만족하면 Mastered', () => {
    const clock = fakeClock();
    let p = emptyProgress();
    p = recordCorrect(p, 'EN_TO_KO', clock.now());
    p = recordCorrect(p, 'KO_TO_EN', clock.now());
    expect(isMastered(p)).toBe(false); // 아직 시간이 안 지났다

    clock.advance(MASTERY_DELAY_MS + 1000);
    p = recordCorrect(p, 'EN_TO_KO', clock.now());
    expect(p.delayedRecall).toBe(true);
    expect(isMastered(p)).toBe(true);
    expect(p.stage).toBe(5);
  });

  it('오답은 단계를 1 내린다 (0 으로 초기화하지 않는다)', () => {
    const clock = fakeClock();
    let p = emptyProgress();
    p = recordCorrect(p, 'EN_TO_KO', clock.now());
    p = recordCorrect(p, 'KO_TO_EN', clock.now());
    expect(p.stage).toBe(2);
    p = recordWrong(p);
    expect(p.stage).toBe(1);
    expect(p.right).toBe(2); // 지금까지의 학습 기록은 남는다
  });
});

describe('Spaced Repetition — 두 큐를 분리한다', () => {
  it('세션 내: 오답은 30초 뒤에 다시 낸다', () => {
    const clock = fakeClock();
    const q = new ReviewQueue();
    q.pushWrong('word_000001', clock.now());
    expect(q.dueNow(clock.now())).toBeNull(); // 바로는 안 낸다
    clock.advance(29_000);
    expect(q.dueNow(clock.now())).toBeNull();
    clock.advance(2_000);
    expect(q.dueNow(clock.now())).toBe('word_000001');
  });

  it('세션 내: 또 틀리면 5분 뒤로 미룬다', () => {
    const clock = fakeClock();
    const q = new ReviewQueue();
    q.pushWrong('w1', clock.now());
    clock.advance(31_000);
    q.pushWrong('w1', clock.now()); // 재출제에서 또 틀렸다
    expect(q.dueNow(clock.now())).toBeNull();
    clock.advance(299_000);
    expect(q.dueNow(clock.now())).toBeNull();
    clock.advance(2_000);
    expect(q.dueNow(clock.now())).toBe('w1');
  });

  it('세션 내 정답이면 큐에서 빠진다', () => {
    const clock = fakeClock();
    const q = new ReviewQueue();
    q.pushWrong('w1', clock.now());
    q.clearSession('w1');
    clock.advance(60_000);
    expect(q.dueNow(clock.now())).toBeNull();
    expect(q.sessionSize).toBe(0);
  });

  it('세션 간: 연속 정답이 늘면 간격이 길어진다', () => {
    const clock = fakeClock();
    let p = emptyProgress();
    const gaps: number[] = [];
    for (let i = 0; i < 4; i++) {
      p = recordCorrect(p, i % 2 ? 'KO_TO_EN' : 'EN_TO_KO', clock.now());
      p = scheduleNext(p, true, clock.now());
      gaps.push(Math.round((p.dueAt - clock.now()) / (24 * 60 * 60 * 1000)));
      clock.advance(MASTERY_DELAY_MS);
    }
    // 3분(같은 판) → 1일 → 3일 → 7일 로 늘어난다
    expect(gaps[0]).toBe(0); // 3분 = 0일
    expect(gaps[1]).toBeGreaterThanOrEqual(1);
    expect(gaps[2]).toBeGreaterThan(gaps[1]);
    expect(gaps[3]).toBeGreaterThan(gaps[2]);
  });

  it('세션 간: 오답이면 다음 판에 바로 나온다', () => {
    const clock = fakeClock();
    let p = emptyProgress();
    p = recordCorrect(p, 'EN_TO_KO', clock.now());
    p = scheduleNext(p, true, clock.now());
    clock.advance(1000);
    p = recordWrong(p);
    p = scheduleNext(p, false, clock.now());
    expect(p.dueAt).toBeLessThanOrEqual(clock.now());
  });
});

describe('Adaptive — 난이도가 급변하지 않는다', () => {
  it('한 문항의 theta 변화는 0.15 이하다', () => {
    let ability = initialAbility(5);
    const before = ability.theta;
    // 아주 어려운 문제를 맞혀도 한 번에 크게 뛰지 않는다
    ability = updateAbility(ability, 1, true, false);
    expect(Math.abs(ability.theta - before)).toBeLessThanOrEqual(0.1501);
  });

  it('계속 맞히면 실력 추정이 오르고, 계속 틀리면 내려간다', () => {
    let up = initialAbility(3);
    let down = initialAbility(3);
    for (let i = 0; i < 30; i++) {
      up = updateAbility(up, 0.5, true, false);
      down = updateAbility(down, 0.2, false, false);
    }
    expect(up.theta).toBeGreaterThan(3.3);
    expect(down.theta).toBeLessThan(2.7);
  });

  it('목표 난이도 밴드는 실력보다 조금 아래다 (정답률 75~85%)', () => {
    const band = targetDifficultyRange(5);
    expect(band.min).toBeLessThan(band.max);
    // theta 5 라면 목표 난이도는 5 미만(= 조금 쉬운 쪽)이어야 한다
    const midLevel = 1 + ((band.min + band.max) / 2) * 9;
    expect(midLevel).toBeLessThan(5);
  });

  it('Calibration 은 10문항이고 그 뒤에 신뢰도가 오른다', () => {
    let ability = initialAbility(2);
    for (let i = 0; i < CALIBRATION_COUNT; i++) ability = updateAbility(ability, 0.3, true, true);
    expect(ability.answered).toBe(CALIBRATION_COUNT);
    expect(ability.confidence).toBeGreaterThan(0.3);
  });
});

describe('출제 정책', () => {
  const makeEngine = (clock = fakeClock()) => ({
    engine: new LearningEngine(bank, createRng(4242), clock.now),
    clock,
  });

  it('20문항의 카테고리 비율이 신규 50 / 복습 30 / 취약 15 / 보너스 5 에 맞는다', () => {
    const { engine } = makeEngine();
    // 모든 단어를 "본 적 있고 아직 Mastered 아님"으로 만들어 복습·취약 후보를 준다
    for (const w of bank.all().slice(0, 60)) {
      engine.progress[w.id] = {
        ...emptyProgress(),
        right: 2,
        wrong: 2, // 정답률 50% → 취약
        clearedTypes: ['EN_TO_KO'],
        lastCorrectAt: 1,
      };
    }
    for (let i = 0; i < 20; i++) {
      const pick = engine.next();
      engine.record(pick, true);
    }
    const counts = engine.categoryCounts();
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    expect(total).toBe(20);
    // 세션 내 복습이 끼어들 수 있으므로(정답만 줬으니 여기서는 0) 자루 비율이 그대로 나온다
    expect(counts['new']).toBe(10);
    expect(counts['review'] ?? 0).toBe(6);
    expect(counts['weak'] ?? 0).toBe(3);
    expect(counts['bonus'] ?? 0).toBe(1);
  });

  it('세션 내 복습이 비율보다 우선한다 — 틀린 단어가 30초 뒤에 나온다', () => {
    const clock = fakeClock();
    const { engine } = makeEngine(clock);
    const first = engine.next();
    engine.record(first, false); // 틀렸다

    clock.advance(31_000);
    const picks: string[] = [];
    for (let i = 0; i < 3; i++) {
      const pick = engine.next();
      picks.push(pick.word.id);
      engine.record(pick, true);
    }
    expect(picks).toContain(first.word.id);
  });

  it('같은 단어를 연속으로 내지 않는다', () => {
    const { engine } = makeEngine();
    const seen: string[] = [];
    for (let i = 0; i < 40; i++) {
      const pick = engine.next();
      seen.push(pick.word.id);
      engine.record(pick, true);
    }
    for (let i = 1; i < seen.length; i++) expect(seen[i]).not.toBe(seen[i - 1]);
  });

  it('어려운 문제를 연속해서 내지 않는다', () => {
    const { engine } = makeEngine();
    // Calibration 을 지나 정상 출제 구간으로 보낸다
    for (let i = 0; i < CALIBRATION_COUNT; i++) engine.record(engine.next(), true);

    const diffs: number[] = [];
    for (let i = 0; i < 30; i++) {
      const pick = engine.next();
      diffs.push(pick.word.difficulty);
      engine.record(pick, true);
    }
    const band = targetDifficultyRange(engine.ability.theta);
    const hardLine = (band.min + band.max) / 2 + 0.1;
    let consecutiveHard = 0;
    let maxRun = 0;
    for (const d of diffs) {
      consecutiveHard = d > hardLine ? consecutiveHard + 1 : 0;
      maxRun = Math.max(maxRun, consecutiveHard);
    }
    // 파도 곡선상 어려운 구간이 두 번 연달아 오지 않는다
    expect(maxRun).toBeLessThanOrEqual(2);
  });

  /** 그림 문제가 이 슬롯을 가로채면 그림 있는 단어만 마스터가 늦어진다 — 게이트가 우선이다 */
  it('아직 못 맞힌 방향을 먼저 낸다 (그림 문제보다 Mastery 게이트가 우선)', () => {
    const clock = fakeClock();
    const { engine } = makeEngine(clock);
    const target = bank.get('apple')!;
    engine.progress[target.id] = {
      ...emptyProgress(),
      right: 3,
      clearedTypes: ['EN_TO_KO'], // KO→EN 만 남았다
      lastCorrectAt: clock.now(),
    };
    // 이 단어가 뽑힐 때의 유형을 확인한다
    let found = false;
    for (let i = 0; i < 80 && !found; i++) {
      const pick = engine.next();
      if (pick.word.id === target.id) {
        expect(pick.type).toBe('KO_TO_EN');
        found = true;
      }
      engine.record(pick, true);
    }
    expect(found).toBe(true);
  });

  it('두 방향을 다 맞힌 뒤에는 그림 문제가 섞인다 (PRD 2장 TYPE_C)', () => {
    const clock = fakeClock();
    const engine = new LearningEngine(bank, createRng(3), clock.now);
    const withImage = bank.all().find((w) => w.imageAsset)!;
    engine.progress[withImage.id] = {
      ...emptyProgress(),
      right: 4,
      clearedTypes: ['EN_TO_KO', 'KO_TO_EN'],
      lastCorrectAt: clock.now(),
    };
    const types = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const pick = engine.next();
      if (pick.word.id === withImage.id) types.add(pick.type);
      engine.record(pick, true);
    }
    expect([...types]).toContain('IMAGE_TO_EN');
  });

  it('취약 단어는 정답률 60% 미만 · 2회 이상 시도한 단어다', () => {
    expect(isWeak({ ...emptyProgress(), right: 0, wrong: 1 })).toBe(false); // 한 번은 낙인이 아니다
    expect(isWeak({ ...emptyProgress(), right: 1, wrong: 3 })).toBe(true);
    expect(isWeak({ ...emptyProgress(), right: 4, wrong: 1 })).toBe(false);
  });

  /**
   * 가상 학생 시뮬레이션 — Phase 9 의 `npm run sim` 축약판.
   *
   * 실력이 정해진 학생이 IRT 확률대로 답한다. 엔진이 난이도를 제대로 조절한다면
   * **관측 정답률이 목표 밴드(75~85%) 근처에 앉고, theta 가 실제 실력으로 수렴해야 한다.**
   * 이 검사가 adaptive 의 부호 오류를 두 번째로 걸러 준다.
   */
  it('가상 학생의 정답률이 목표 밴드에 수렴한다', () => {
    const trueAbility = 4.5; // 초5 수준 학생
    const rng = createRng(99);
    const clock = fakeClock();
    const engine = new LearningEngine(bank, createRng(7), clock.now);

    let correctCount = 0;
    const N = 60;
    for (let i = 0; i < N; i++) {
      const pick = engine.next();
      const level = 1 + pick.word.difficulty * 9;
      const p = 1 / (1 + Math.exp(-(trueAbility - level)));
      const correct = rng() < p;
      if (correct) correctCount++;
      engine.record(pick, correct);
      clock.advance(8000); // 문제당 8초
    }

    const accuracy = correctCount / N;
    expect(accuracy, `정답률 ${(accuracy * 100).toFixed(0)}%`).toBeGreaterThan(0.65);
    expect(accuracy, `정답률 ${(accuracy * 100).toFixed(0)}%`).toBeLessThan(0.95);
    // 추정 실력이 실제 실력 근처로 온다 (calibration 10문항 + 50문항)
    expect(Math.abs(engine.ability.theta - trueAbility)).toBeLessThan(2.2);
  });

  /**
   * 실력대별 리포트. Phase 9 의 밸런스 시뮬레이터가 붙을 자리이고, 지금은
   * **모든 실력대에서 정답률이 무너지지 않는지**를 확인한다.
   * (초2 수준 학생에게 중등 단어만 나오거나, 잘하는 학생이 계속 쉬운 문제만 받으면 실패)
   */
  it('실력대별 정답률이 전부 밴드 안에 든다', () => {
    const rows: string[] = [];
    for (const trueAbility of [2, 3.5, 5, 6.5]) {
      const rng = createRng(1234);
      const clock = fakeClock();
      const engine = new LearningEngine(bank, createRng(77), clock.now);
      let correct = 0;
      const N = 100;
      for (let i = 0; i < N; i++) {
        /* **보스 모드로 돌린다.** 문제는 보스전에서만 나오므로(game/session.ts) 이것이
           실제 경로다. 평소 자루로 재면 게임에 없는 상황을 측정하게 된다 */
        const pick = engine.next({ boss: true });
        const level = 1 + pick.word.difficulty * 9;
        const ok = rng() < 1 / (1 + Math.exp(-(trueAbility - level)));
        if (ok) correct++;
        engine.record(pick, ok);
        clock.advance(9000);
      }
      const accuracy = correct / N;
      const c = engine.categoryCounts();
      rows.push(
        `실력 ${trueAbility} → 정답률 ${(accuracy * 100).toFixed(0)}% · theta ${engine.ability.theta.toFixed(2)} · ` +
          `신규 ${c['new'] ?? 0}/복습 ${(c['review'] ?? 0) + (c['session-review'] ?? 0)}/취약 ${c['weak'] ?? 0}/보너스 ${c['bonus'] ?? 0} · ` +
          `Mastered ${engine.summary().mastered}`,
      );
      expect(accuracy, rows.at(-1)).toBeGreaterThan(0.6);
      expect(accuracy, rows.at(-1)).toBeLessThan(0.95);
    }
    console.log('\n  [실력대별 시뮬레이션 100문항 · 보스 모드]\n  ' + rows.join('\n  ') + '\n');
  });

  it('학습 요약이 누적된다', () => {
    const { engine } = makeEngine();
    for (let i = 0; i < 12; i++) engine.record(engine.next(), i % 3 !== 0);
    const summary = engine.summary();
    expect(summary.seen).toBeGreaterThan(0);
    expect(summary.theta).toBeGreaterThan(0);
    expect(summary.pendingSessionReview).toBeGreaterThan(0); // 틀린 게 있으므로
  });
});
