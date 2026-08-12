import { describe, expect, it } from 'vitest';

import { createRng } from '../core/rng';
import { GRADE_BANDS, bandOf, inBand, levelsOf } from './gradeBand';
import { LearningEngine } from './engine';
import { emptyProgress } from './mastery';
import { WordBank } from './words';

/**
 * 문제 레벨 선택 (로비).
 *
 * 화면에서 칩을 누르는 것은 눈으로 보면 알지만, **누른 것이 실제로 출제를 제한하는지**는
 * 눈으로 알 수 없다 — 나오는 단어가 어느 레벨인지는 화면에 없다. 그래서 여기서 검사한다.
 */

const bank = new WordBank();
await bank.loadLevels([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

function engineFor(bandId: string, seed = 7) {
  return new LearningEngine(bank, createRng(seed), () => 1_700_000_000_000, {
    levels: levelsOf(bandId),
  });
}

describe('학년 구간 정의', () => {
  it('자동이 기본값이고 제한이 없다', () => {
    expect(GRADE_BANDS[0].id).toBe('auto');
    expect(levelsOf('auto')).toBeNull();
  });

  it('모르는 값이 들어오면 자동으로 떨어진다 — 저장본이 깨져도 게임이 멈추지 않는다', () => {
    expect(bandOf('없는구간').id).toBe('auto');
    expect(levelsOf('')).toBeNull();
  });

  /** L1 초3 / L2·L3 초4 / L4 초5 / L5 초6 / L6·L7 중1 / L8·L9 중2 / L10 중3 */
  it('모든 레벨이 정확히 한 구간에 속한다 — 빠지거나 겹치는 레벨이 없다', () => {
    const covered = GRADE_BANDS.flatMap((b) => b.levels ?? []);
    expect([...covered].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(new Set(covered).size).toBe(10);
  });

  it('구간은 레벨 순서대로 놓여 있다', () => {
    const bands = GRADE_BANDS.filter((b) => b.levels).map((b) => b.levels!);
    for (let i = 1; i < bands.length; i++) {
      expect(Math.min(...bands[i])).toBeGreaterThan(Math.max(...bands[i - 1]));
    }
  });
});

describe('inBand — 걸러내기', () => {
  it('구간 안의 단어만 남긴다', () => {
    const words = [{ level: 1 }, { level: 5 }, { level: 9 }];
    expect(inBand(words, [1, 2, 3])).toEqual([{ level: 1 }]);
  });

  it('제한이 없으면 그대로 돌려준다', () => {
    const words = [{ level: 1 }, { level: 9 }];
    expect(inBand(words, null)).toBe(words);
  });

  /** 선택은 취향이고, 게임이 멈추는 것보다 약하다 */
  it('구간 안에 하나도 없으면 원본을 돌려준다 — 낼 문제가 없어지면 안 된다', () => {
    const words = [{ level: 9 }, { level: 10 }];
    expect(inBand(words, [1, 2])).toBe(words);
  });
});

describe('출제가 실제로 제한된다', () => {
  const CASES: Array<[string, number[]]> = [
    ['e34', [1, 2, 3]],
    ['e56', [4, 5]],
    ['m1', [6, 7]],
    ['m23', [8, 9, 10]],
  ];
  it.each(CASES)('%s 를 고르면 그 레벨만 나온다', (bandId, levels) => {
    const engine = engineFor(bandId);
    const picked = Array.from({ length: 60 }, () => engine.next().word.level);
    const outside = picked.filter((lv) => !levels.includes(lv));
    expect(outside).toEqual([]);
  });

  /**
   * 자동은 실력을 따르고, 구간은 실력을 **덮어쓴다.**
   *
   * "여러 레벨이 나온다" 로 검사하려다 실패했다 — 목표 난이도가 좁으면 80문항이 모두
   * 같은 레벨일 수 있고 그건 정상이다(레벨은 난이도에서 계산되므로). 실력을 높게 준 뒤
   * **auto 와 구간의 결과가 갈리는지** 보는 것이 이 기능의 실제 계약이다.
   */
  it('자동은 실력을 따라 어려운 단어를 내고, 구간은 그것을 막는다', () => {
    const strong = { theta: 9, confidence: 1, answered: 50 };
    const auto = new LearningEngine(bank, createRng(5), () => 1_700_000_000_000, {
      ability: strong,
      levels: null,
    });
    const capped = new LearningEngine(bank, createRng(5), () => 1_700_000_000_000, {
      ability: strong,
      levels: levelsOf('e34'),
    });

    const autoLevels = Array.from({ length: 40 }, () => auto.next().word.level);
    const cappedLevels = Array.from({ length: 40 }, () => capped.next().word.level);

    // 실력이 높으면 자동은 중등 단어를 낸다
    expect(Math.max(...autoLevels)).toBeGreaterThanOrEqual(8);
    // 같은 실력이어도 초3~4 를 고르면 넘지 않는다
    expect(Math.max(...cappedLevels)).toBeLessThanOrEqual(3);
  });

  /**
   * 초등 구간을 골랐는데 중등 단어가 복습으로 되돌아오면 선택의 의미가 없다.
   * 부모가 "우리 아이는 초등인데 중등 단어가 나온다"를 막으려고 고른 것이다.
   */
  it('복습·취약 큐에 있는 구간 밖 단어도 내지 않는다', () => {
    const engine = engineFor('e34', 21);
    // 중등 단어를 취약하게 만들어 둔다
    for (const w of bank.all().filter((x) => x.level >= 8).slice(0, 12)) {
      engine.progress[w.id] = { ...emptyProgress(), right: 1, wrong: 4, lastCorrectAt: 1 };
    }
    const picked = Array.from({ length: 60 }, () => engine.next().word.level);
    expect(picked.filter((lv) => lv >= 8)).toEqual([]);
  });

  it('보스전에서도 제한이 지켜진다 — 문제는 보스전에서만 나온다', () => {
    const engine = engineFor('m1', 33);
    for (const w of bank.all().filter((x) => x.level <= 2).slice(0, 10)) {
      engine.progress[w.id] = { ...emptyProgress(), right: 1, wrong: 4, lastCorrectAt: 1 };
    }
    const picked = Array.from({ length: 60 }, () => engine.next({ boss: true }).word.level);
    expect(picked.filter((lv) => lv !== 6 && lv !== 7)).toEqual([]);
  });

  it('판 도중이 아니라 로비에서 바꾼다 — setLevels 로 다음 판부터 적용된다', () => {
    const engine = engineFor('e34');
    expect(engine.next().word.level).toBeLessThanOrEqual(3);
    engine.setLevels(levelsOf('m23'));
    const after = Array.from({ length: 20 }, () => engine.next().word.level);
    expect(after.every((lv) => lv >= 8)).toBe(true);
  });
});
