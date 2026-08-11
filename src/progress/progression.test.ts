import { describe, expect, it } from 'vitest';

import { CHARACTERS, PETS, characterOf, emptyCollection, nextUnlock, newlyUnlocked } from './collection';
import {
  MISSION_COUNT,
  MISSION_POOL,
  allDone,
  applyProgress,
  defOf,
  ensureToday,
  rewardFor,
  rollMissions,
  type MissionState,
} from './mission';
import { addExp, emptyPlayer, expForAnswer, expToNext, abilitiesOf } from './player';
import { dayKey } from './stats';
import { emptyStreak, touch } from './streak';

/**
 * 성장·미션·스트릭 테스트.
 *
 * 이 로직은 **날짜가 바뀌어야** 검증된다 — 미션 리셋, 연속 학습 판정, 방패 소모.
 * 실제 시간을 기다릴 수 없으니 `nowMs` 를 인자로 받게 만들었다.
 */

const DAY = 24 * 60 * 60 * 1000;
/** 2026-08-12 12:00 (로컬) 기준 시각 */
const T0 = new Date(2026, 7, 12, 12, 0, 0).getTime();

describe('경험치·레벨', () => {
  it('어려운 문제와 높은 콤보가 더 많은 경험치를 준다', () => {
    const easy = expForAnswer({ difficulty: 0, combo: 1, isRetry: false });
    const hard = expForAnswer({ difficulty: 0.9, combo: 1, isRetry: false });
    const combo = expForAnswer({ difficulty: 0, combo: 10, isRetry: false });
    expect(hard).toBeGreaterThan(easy);
    expect(combo).toBeGreaterThan(easy);
  });

  it('복습 정답은 절반만 준다 — 같은 단어로 경험치를 벌 수 없게', () => {
    const fresh = expForAnswer({ difficulty: 0.5, combo: 3, isRetry: false });
    const retry = expForAnswer({ difficulty: 0.5, combo: 3, isRetry: true });
    expect(retry).toBeLessThan(fresh);
    expect(retry).toBeGreaterThan(0);
  });

  it('경험치가 넘치면 레벨이 오르고 나머지가 이월된다', () => {
    const player = emptyPlayer();
    const need = expToNext(1);
    const { player: after, levelUp } = addExp(player, need + 5);
    expect(levelUp).toEqual({ from: 1, to: 2 });
    expect(after.exp).toBe(5);
  });

  it('한 번에 여러 레벨이 오를 수 있다', () => {
    const { player, levelUp } = addExp(emptyPlayer(), expToNext(1) + expToNext(2) + 1);
    expect(levelUp).toEqual({ from: 1, to: 3 });
    expect(player.level).toBe(3);
  });

  it('능력치는 학습 기록에서 파생된다 (따로 저장하지 않는다)', () => {
    const a = abilitiesOf({ bestCombo: 12, fastCorrect: 30, hardCorrect: 7, masteredWords: 4 });
    expect(a).toEqual({ str: 12, speed: 30, int: 7, memory: 4 });
  });
});

describe('수집 해금', () => {
  it('레벨이 오르면 새 캐릭터·펫이 열린다', () => {
    const opened = newlyUnlocked(1, 4);
    expect(opened.map((o) => o.id)).toContain('female-a'); // Lv.3
    expect(opened.map((o) => o.id)).toContain('cat'); // Lv.4
  });

  it('아직 해금되지 않은 캐릭터를 골라도 기본 캐릭터로 떨어진다', () => {
    const state = { ...emptyCollection(), characterId: 'female-c' };
    expect(characterOf(state, 1).id).toBe(CHARACTERS[0].id);
    expect(characterOf(state, 20).id).toBe('female-c');
  });

  it('다음 해금 목표를 알려 준다 (Phase 6 완료 기준)', () => {
    const next = nextUnlock(1);
    expect(next?.unlockLevel).toBe(3);
    expect(nextUnlock(999)).toBeNull();
  });

  it('기본 캐릭터·펫은 Lv.1 부터 쓸 수 있다', () => {
    expect(CHARACTERS[0].unlockLevel).toBe(1);
    expect(PETS[0].unlockLevel).toBe(1);
  });
});

describe('Daily Mission', () => {
  it('같은 날에는 항상 같은 미션이 나온다 — 새로고침으로 다시 뽑을 수 없다', () => {
    const a = rollMissions(T0, 5);
    const b = rollMissions(T0 + 3 * 60 * 60 * 1000, 5);
    expect(a.list.map((m) => m.id)).toEqual(b.list.map((m) => m.id));
  });

  it('날짜가 바뀌면 새로 뽑는다', () => {
    const today = rollMissions(T0, 5);
    const tomorrow = ensureToday(today, T0 + DAY, 5);
    expect(tomorrow.day).toBe(dayKey(T0 + DAY));
    expect(tomorrow.list.every((m) => m.progress === 0)).toBe(true);
  });

  it('레벨이 낮으면 어려운 미션을 내지 않는다', () => {
    const rolled = rollMissions(T0, 1);
    for (const mission of rolled.list) expect(defOf(mission.id).minLevel).toBeLessThanOrEqual(1);
  });

  /** 개수 검사가 빠져 있어서 "3개 요청했는데 2개"가 브라우저에서야 드러났다 */
  it('요청한 개수만큼 뽑는다 — 서로 다른 미션으로', () => {
    for (const level of [1, 3, 5, 10]) {
      const rolled = rollMissions(T0, level);
      const available = MISSION_POOL.filter((m) => m.minLevel <= level).length;
      expect(rolled.list.length, `Lv.${level} (후보 ${available}개)`).toBe(
        Math.min(MISSION_COUNT, available),
      );
      expect(new Set(rolled.list.map((m) => m.id)).size).toBe(rolled.list.length);
    }
  });

  it('누적형은 더하고 최고기록형은 큰 값으로 갱신한다', () => {
    // 문제 수(누적)와 층수(최고기록)를 함께 검사한다
    let state: MissionState = {
      day: dayKey(T0),
      list: [
        { id: 'answer20', progress: 0, done: false },
        { id: 'floor20', progress: 0, done: false },
      ],
      chestClaimed: false,
    };
    const input = {
      answered: 12,
      retryCorrect: 0,
      bestCombo: 2,
      floor: 15,
      masteredCount: 0,
      accuracy: 0.5,
      plays: 1,
    };
    state = applyProgress(state, input).state;
    expect(state.list[0].progress).toBe(12);
    expect(state.list[1].progress).toBe(15);

    // 두 번째 판: 문제는 더해지고, 층수는 더 낮으므로 유지된다
    const second = applyProgress(state, { ...input, answered: 12, floor: 9 });
    expect(second.state.list[0].progress).toBe(20);
    expect(second.state.list[0].done).toBe(true);
    expect(second.state.list[1].progress).toBe(15);
    expect(second.completed).toEqual(['answer20']);
  });

  it('정답률 미션은 5문제 이상 푼 판에서만 인정한다', () => {
    const base: MissionState = {
      day: dayKey(T0),
      list: [{ id: 'accuracy80', progress: 0, done: false }],
      chestClaimed: false,
    };
    const input = {
      answered: 3,
      retryCorrect: 0,
      bestCombo: 3,
      floor: 3,
      masteredCount: 0,
      accuracy: 1,
      plays: 1,
    };
    expect(applyProgress(base, input).state.list[0].done).toBe(false);
    expect(applyProgress(base, { ...input, answered: 6 }).state.list[0].done).toBe(true);
  });

  it('전부 완료하면 상자 보상이 붙는다', () => {
    const rolled = rollMissions(T0, 20);
    const done = { ...rolled, list: rolled.list.map((m) => ({ ...m, done: true })) };
    expect(allDone(done)).toBe(true);
    const withChest = rewardFor([rolled.list[0].id], true);
    const withoutChest = rewardFor([rolled.list[0].id], false);
    expect(withChest).toBeGreaterThan(withoutChest);
  });

  it('미션 풀의 모든 정의를 조회할 수 있다', () => {
    for (const def of MISSION_POOL) expect(defOf(def.id)).toBe(def);
  });
});

describe('Streak', () => {
  it('어제 플레이했으면 하루 늘어난다', () => {
    const start = touch(emptyStreak(), T0);
    expect(start.state.days).toBe(1);
    const next = touch(start.state, T0 + DAY);
    expect(next.state.days).toBe(2);
    expect(next.extended).toBe(true);
  });

  it('같은 날 여러 판을 해도 늘지 않는다', () => {
    const first = touch(emptyStreak(), T0);
    const again = touch(first.state, T0 + 60_000);
    expect(again.state.days).toBe(1);
    expect(again.extended).toBe(false);
  });

  it('7일마다 방패를 준다', () => {
    let state = emptyStreak();
    for (let i = 0; i < 7; i++) state = touch(state, T0 + i * DAY).state;
    expect(state.days).toBe(7);
    expect(state.shields).toBe(1);
  });

  it('하루 빠져도 방패가 있으면 기록을 지킨다', () => {
    let state = emptyStreak();
    for (let i = 0; i < 7; i++) state = touch(state, T0 + i * DAY).state;
    expect(state.shields).toBe(1);

    // 8일차를 건너뛰고 9일차에 플레이
    const after = touch(state, T0 + 8 * DAY);
    expect(after.shieldUsed).toBe(true);
    expect(after.state.days).toBe(8);
    expect(after.state.shields).toBe(0);
  });

  it('방패가 없으면 1일로 돌아가되 최고 기록은 남는다', () => {
    let state = emptyStreak();
    for (let i = 0; i < 3; i++) state = touch(state, T0 + i * DAY).state;
    expect(state.days).toBe(3);
    const after = touch(state, T0 + 10 * DAY);
    expect(after.state.days).toBe(1);
    expect(after.state.best).toBe(3);
  });

  it('기념 지점을 알려 준다', () => {
    let state = emptyStreak();
    let milestone: number | null = null;
    for (let i = 0; i < 3; i++) {
      const r = touch(state, T0 + i * DAY);
      state = r.state;
      if (r.milestone) milestone = r.milestone;
    }
    expect(milestone).toBe(3);
  });
});
