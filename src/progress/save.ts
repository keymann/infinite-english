import type { Ability } from '../learning/adaptive';
import type { WordProgress } from '../learning/mastery';
import { emptyCollection, type CollectionState } from './collection';
import { emptyMissions, type MissionState } from './mission';
import { emptyPlayer, type PlayerState } from './player';
import { emptyStreak, type StreakState } from './streak';
import { emptyStats, type LifetimeStats } from './stats';

/**
 * 저장 — localStorage.
 *
 * 학습 기록은 **날리면 안 되는 데이터**다. 그래서 처음부터 두 가지를 갖췄다.
 *  1. 스키마 버전(`v`)과 마이그레이션
 *  2. **디바운스 저장** — 문제마다 즉시 쓰면 한 판에 수십 번 직렬화한다
 *
 * 계정도 서버도 없다. 아동 대상이라 개인정보를 만들지 않는다 (PRD 31장).
 * 용량이 1MB 를 넘으면 IndexedDB 로 옮긴다 — 이 파일의 인터페이스는 그대로 두면 된다.
 */

const KEY = 'infinite-english/save';
const VERSION = 2;
const DEBOUNCE_MS = 1200;

/** 중단된 판 — 이어하기 (PRD 1장: 플레이 중간에 종료해도 진행 상황을 저장한다) */
export type RunState = {
  seed: number;
  floor: number;
  hp: number;
  combo: number;
  score: number;
  asked: number;
  correct: number;
  wrong: number;
};

export type SaveData = {
  v: number;
  ability: Ability;
  progress: Record<string, WordProgress>;
  stats: LifetimeStats;
  player: PlayerState;
  missions: MissionState;
  streak: StreakState;
  collection: CollectionState;
  /** 이어할 판이 없으면 null */
  run: RunState | null;
  meta: {
    lastSeed: number;
    lastPlayedAt: number;
  };
};

export function emptySave(): SaveData {
  return {
    v: VERSION,
    ability: { theta: 2, confidence: 0, answered: 0 },
    progress: {},
    stats: emptyStats(),
    player: emptyPlayer(),
    missions: emptyMissions(),
    streak: emptyStreak(),
    collection: emptyCollection(),
    run: null,
    meta: { lastSeed: 0, lastPlayedAt: 0 },
  };
}

/**
 * 옛 저장본을 현재 스키마로 올린다.
 *
 * v1 → v2: 성장·미션·스트릭·수집·이어하기가 추가됐다. **학습 기록(ability·progress·stats)은
 * 그대로 살린다** — 여기서 초기화해 버리면 며칠 쌓은 단어 숙련도가 사라진다.
 * 성장 수치는 새로 시작하되, 누적 통계에서 되살릴 수 있는 것은 되살린다.
 */
function migrate(raw: Partial<SaveData> & { v?: number }): SaveData {
  const base = emptySave();
  if (raw.v === VERSION) return { ...base, ...raw } as SaveData;

  const merged: SaveData = {
    ...base,
    ability: raw.ability ?? base.ability,
    progress: raw.progress ?? base.progress,
    stats: { ...base.stats, ...(raw.stats ?? {}) },
    meta: { ...base.meta, ...(raw.meta ?? {}) },
    v: VERSION,
  };

  if ((raw.v ?? 1) < 2) {
    // v1 에는 fastCorrect·hardCorrect 기록이 없다. 0 에서 시작하되 골드는
    // 이미 푼 문제만큼 소급해 준다 — 열심히 한 아이가 빈손으로 시작하면 안 된다
    merged.player = { ...base.player, gold: Math.min(500, merged.stats.correct * 3) };
  }
  return merged;
}

export function load(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptySave();
    const parsed = JSON.parse(raw) as Partial<SaveData>;
    if (!parsed || typeof parsed !== 'object') return emptySave();
    return migrate(parsed);
  } catch {
    // 저장본이 깨졌다고 게임이 안 켜지면 안 된다
    return emptySave();
  }
}

let timer: number | null = null;
let pending: SaveData | null = null;

function flush() {
  if (!pending) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(pending));
  } catch {
    // 용량 초과·프라이빗 모드 — 저장 실패가 플레이를 막지 않는다
  }
  pending = null;
  timer = null;
}

/** 디바운스 저장 */
export function save(data: SaveData) {
  pending = data;
  if (timer !== null) return;
  timer = setTimeout(flush, DEBOUNCE_MS) as unknown as number;
}

/** 즉시 저장 — 판이 끝났을 때처럼 놓치면 안 되는 시점에 부른다 */
export function saveNow(data: SaveData) {
  pending = data;
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  flush();
}

export function clear() {
  localStorage.removeItem(KEY);
}

export { VERSION as SAVE_VERSION };
