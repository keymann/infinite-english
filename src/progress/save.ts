import type { Ability } from '../learning/adaptive';
import type { WordProgress } from '../learning/mastery';
import { emptyStats, type LifetimeStats } from './stats';

/**
 * 저장 — localStorage.
 *
 * 학습 기록은 **날리면 안 되는 데이터**다. 그래서 처음부터 두 가지를 갖춘다.
 *  1. 스키마 버전(`v`)과 마이그레이션 자리
 *  2. **디바운스 저장** — 문제마다 즉시 쓰면 한 판에 수십 번 직렬화한다
 *
 * 계정도 서버도 없다. 아동 대상이라 개인정보를 만들지 않는다 (PRD 31장).
 * 용량이 1MB 를 넘으면 IndexedDB 로 옮긴다 — 이 파일의 인터페이스는 그대로 두면 된다.
 */

const KEY = 'infinite-english/save';
const VERSION = 1;
const DEBOUNCE_MS = 1200;

export type SaveData = {
  v: number;
  ability: Ability;
  progress: Record<string, WordProgress>;
  stats: LifetimeStats;
  meta: {
    /** 계단 시드 — 이어하기에서 같은 계단을 복원한다 */
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
    meta: { lastSeed: 0, lastPlayedAt: 0 },
  };
}

/** 버전이 다른 저장본을 현재 스키마로 올린다. 지금은 v1 뿐이라 통과만 시킨다 */
function migrate(raw: SaveData): SaveData {
  if (raw.v === VERSION) return raw;
  // 앞으로 v2 가 생기면 여기서 단계적으로 올린다. 알 수 없는 버전은 버리지 않고
  // 기본값과 병합해 **학습 기록만이라도 살린다**
  return { ...emptySave(), ...raw, v: VERSION };
}

export function load(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptySave();
    const parsed = JSON.parse(raw) as SaveData;
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
