import { beforeEach, describe, expect, it } from 'vitest';

import { emptyProgress } from '../learning/mastery';
import { SAVE_VERSION, clear, load, saveNow } from './save';

/**
 * 저장·마이그레이션 테스트.
 *
 * **학습 기록은 날리면 안 되는 데이터다.** 스키마가 올라갈 때 옛 저장본의 단어 숙련도가
 * 사라지면 며칠 쌓은 학습이 없어진다. 그래서 마이그레이션을 테스트로 고정한다.
 *
 * jsdom 을 붙이지 않고 localStorage 만 흉내낸다 — 이 파일이 필요한 건 그것뿐이다.
 */

const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() {
    return store.size;
  },
} as Storage;

const KEY = 'infinite-english/save';

beforeEach(() => store.clear());

describe('저장', () => {
  it('저장본이 없으면 기본값을 돌려준다', () => {
    const data = load();
    expect(data.v).toBe(SAVE_VERSION);
    expect(data.player.level).toBe(1);
    expect(data.run).toBeNull();
  });

  it('저장한 값을 그대로 읽는다', () => {
    const data = load();
    data.player = { ...data.player, level: 4, gold: 120, fastCorrect: 9, hardCorrect: 3 };
    data.progress['word_000001'] = {
      stage: 5,
      clearedTypes: ['EN_TO_KO', 'KO_TO_EN'],
      delayedRecall: true,
      right: 6,
      wrong: 1,
      lastCorrectAt: 123,
      ease: 2.6,
      dueAt: 456,
      streak: 3,
    };
    saveNow(data);

    const again = load();
    expect(again.player.level).toBe(4);
    expect(again.progress['word_000001'].stage).toBe(5);
  });

  it('깨진 저장본이 게임을 막지 않는다', () => {
    store.set(KEY, '{ 이건 JSON 이 아니다');
    expect(load().player.level).toBe(1);
  });

  it('clear() 하면 기본값으로 돌아간다', () => {
    const data = load();
    data.player = { ...data.player, gold: 500 };
    saveNow(data);
    clear();
    expect(load().player.gold).toBe(0);
  });
});

describe('v1 → v2 마이그레이션', () => {
  /** Phase 4 시점의 저장본 (성장·미션·스트릭·수집이 없다) */
  const v1 = {
    v: 1,
    ability: { theta: 4.7, confidence: 0.48, answered: 24 },
    progress: {
      word_000001: {
        stage: 5,
        clearedTypes: ['EN_TO_KO', 'KO_TO_EN'],
        delayedRecall: true,
        right: 8,
        wrong: 2,
        lastCorrectAt: 111,
        ease: 2.5,
        dueAt: 222,
        streak: 4,
      },
      word_000002: {
        stage: 2,
        clearedTypes: ['EN_TO_KO'],
        delayedRecall: false,
        right: 2,
        wrong: 3,
        lastCorrectAt: 90,
        ease: 2.2,
        dueAt: 300,
        streak: 0,
      },
    },
    stats: {
      questions: 40,
      correct: 30,
      wrong: 10,
      answerMsTotal: 180_000,
      bestCombo: 7,
      playMsTotal: 600_000,
      playsByDay: { '2026-08-11': 3 },
      bestFloor: 26,
      retryCorrect: 6,
      retryTotal: 9,
    },
    meta: { lastSeed: 42, lastPlayedAt: 1_700_000_000_000 },
  };

  it('학습 기록(숙련도·실력 추정·누적 통계)을 그대로 살린다', () => {
    store.set(KEY, JSON.stringify(v1));
    const data = load();

    expect(data.v).toBe(SAVE_VERSION);
    expect(data.ability.theta).toBe(4.7);
    expect(Object.keys(data.progress)).toHaveLength(2);
    expect(data.progress['word_000001'].stage).toBe(5);
    expect(data.stats.questions).toBe(40);
    expect(data.stats.bestFloor).toBe(26);
    expect(data.meta.lastSeed).toBe(42);
  });

  it('새 필드는 기본값으로 채운다', () => {
    store.set(KEY, JSON.stringify(v1));
    const data = load();

    expect(data.player.level).toBe(1);
    expect(data.missions.list).toEqual([]);
    expect(data.streak.days).toBe(0);
    expect(data.collection.characterId).toBe('male-a');
    expect(data.run).toBeNull();
  });

  it('이미 푼 문제만큼 골드를 소급해 준다 — 빈손으로 시작하지 않게', () => {
    store.set(KEY, JSON.stringify(v1));
    expect(load().player.gold).toBe(90); // 정답 30개 × 3
  });

  it('통계에 없던 필드(fastCorrect 등)가 0 으로 들어간다', () => {
    store.set(KEY, JSON.stringify(v1));
    const data = load();
    expect(data.player.fastCorrect).toBe(0);
    expect(data.player.hardCorrect).toBe(0);
  });

  it('마이그레이션 결과를 다시 저장하면 v2 로 남는다', () => {
    store.set(KEY, JSON.stringify(v1));
    saveNow(load());
    expect(JSON.parse(store.get(KEY)!).v).toBe(SAVE_VERSION);
  });
});

describe('문제 레벨 선택 (levelBand)', () => {
  it('기본값은 자동이다', () => {
    expect(load().levelBand).toBe('auto');
  });

  it('고른 값이 저장되고 다시 읽힌다', () => {
    const data = load();
    data.levelBand = 'm23';
    saveNow(data);
    expect(load().levelBand).toBe('m23');
  });

  /**
   * **스키마 버전을 올리지 않았다.** 이 필드가 없는 기존 v2 저장본이 그대로 열리고
   * 기본값('auto')이 채워지는지 — 그것이 버전을 올리지 않은 근거다 (save.ts 주석).
   */
  it('필드가 없는 기존 저장본이 자동으로 열린다 — 학습 기록도 그대로', () => {
    const data = load();
    data.player = { ...data.player, level: 5, gold: 300 };
    data.progress = { w1: { ...emptyProgress(), right: 3, wrong: 1, stage: 2 } };
    saveNow(data);

    // 저장본에서 levelBand 키를 지운다 (= 이 기능 이전에 저장된 파일)
    const raw = JSON.parse(store.get(KEY)!);
    expect(raw.v).toBe(SAVE_VERSION);
    delete raw.levelBand;
    store.set(KEY, JSON.stringify(raw));

    const loaded = load();
    expect(loaded.levelBand).toBe('auto');
    expect(loaded.player.gold).toBe(300);
    expect(loaded.progress.w1.right).toBe(3);
  });
});
