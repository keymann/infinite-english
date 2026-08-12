import type { Rng } from '../core/rng';

/**
 * 랜덤 이벤트 (PRD 20장).
 *
 * 같은 루프가 30번 반복되면 지루하다. 이벤트는 **규칙을 잠깐 바꿔** 리듬을 만든다.
 * 6종 모두 "문제를 푼다"는 뼈대는 그대로 두고 보상·제약만 건드린다 —
 * 새 조작을 배워야 하는 이벤트는 아이에게 벽이 된다.
 *
 * | 이벤트 | 규칙 변화 |
 * |---|---|
 * | Treasure | 보물상자 — 즉시 골드 |
 * | Mystery | 실력보다 어려운 문제 하나. 맞히면 보상 2배 |
 * | Speed | 제한 시간 안에 답하면 보너스, 넘겨도 벌은 없다 |
 * | Double XP | 다음 3문제 경험치 2배 |
 * | Golden Word | 특별 단어 — 맞히면 골드 + 경험치 크게 |
 * | Escape | 제한 시간 안에 계단 구간을 올라야 콤보를 지킨다 |
 *
 * **어떤 이벤트도 HP 를 깎지 않는다.** HP 는 영어 오답 전용이라는 규칙을 이벤트가
 * 깨면, 아이는 왜 죽었는지 모른다 (기획서 3.2절).
 */

export type EventId = 'treasure' | 'mystery' | 'speed' | 'doubleXp' | 'goldenWord' | 'escape';

export type EventDef = {
  id: EventId;
  label: string;
  /** 한 줄 설명 — 배너에 그대로 띄운다 */
  hint: string;
  /** 이 층부터 나온다 — 첫 몇 층은 조작을 익히는 구간이라 방해하지 않는다 */
  fromFloor: number;
  weight: number;
};

export const EVENTS: EventDef[] = [
  { id: 'treasure', label: '보물상자', hint: '골드를 찾았다!', fromFloor: 3, weight: 3 },
  { id: 'doubleXp', label: 'DOUBLE XP', hint: '다음 3문제 경험치 2배!', fromFloor: 5, weight: 3 },
  { id: 'goldenWord', label: 'GOLDEN WORD', hint: '이 단어를 맞히면 큰 보상!', fromFloor: 6, weight: 3 },
  { id: 'speed', label: 'SPEED', hint: '5초 안에 맞히면 보너스!', fromFloor: 8, weight: 2 },
  { id: 'mystery', label: 'MYSTERY', hint: '어려운 문제 — 보상 2배!', fromFloor: 10, weight: 2 },
  { id: 'escape', label: 'ESCAPE!', hint: '시간 안에 계단을 올라라!', fromFloor: 12, weight: 2 },
];

/** 몇 문제마다 이벤트를 시도할지 */
const EVENT_INTERVAL = 5;
/** 시도할 때 실제로 발생할 확률 */
const EVENT_CHANCE = 0.55;

/** Speed 이벤트 제한 시간(초) */
export const SPEED_LIMIT_SEC = 5;
/** Escape 이벤트 제한 시간(초) */
export const ESCAPE_LIMIT_SEC = 8;
/** Double XP 지속 문제 수 */
export const DOUBLE_XP_QUESTIONS = 3;

export type ActiveEvent = {
  def: EventDef;
  /** 남은 적용 문제 수 (doubleXp 처럼 지속되는 이벤트용) */
  remaining: number;
};

export type EventDecision = {
  event: EventDef | null;
  /** 주기 조건을 통과해 실제로 확률을 굴렸는지 — 계측용 */
  attempted: boolean;
};

/**
 * 다음 문제에 이벤트를 붙일지 결정한다.
 *
 * 확률은 층과 문제 수로 조절한다 (PRD 20장: "난이도와 플레이 시간에 따라 조절").
 * 매 문제마다 굴리지 않고 **5문제마다** 굴리는 이유: 연달아 두 번 터지면 이벤트가
 * 기본 규칙처럼 느껴져 특별함이 사라진다.
 */
export function rollEvent(options: {
  asked: number;
  floor: number;
  rng: Rng;
  /** 직전에 나온 이벤트 — 같은 것을 연달아 내지 않는다 */
  lastId: EventId | null;
  /** 보스전 중에는 이벤트를 내지 않는다 */
  inBoss: boolean;
}): EventDecision {
  const { asked, floor, rng, lastId, inBoss } = options;
  if (inBoss) return { event: null, attempted: false };
  if (asked === 0 || asked % EVENT_INTERVAL !== 0) return { event: null, attempted: false };
  if (rng() > EVENT_CHANCE) return { event: null, attempted: true };

  const pool = EVENTS.filter((e) => e.fromFloor <= floor && e.id !== lastId);
  if (pool.length === 0) return { event: null, attempted: true };

  const total = pool.reduce((sum, e) => sum + e.weight, 0);
  let pick = rng() * total;
  for (const def of pool) {
    pick -= def.weight;
    if (pick <= 0) return { event: def, attempted: true };
  }
  return { event: pool[pool.length - 1], attempted: true };
}

/**
 * **보스가 등장할 때** 이벤트를 굴린다.
 *
 * 문제를 보스전에서만 내게 되자 `rollEvent` 가 영구히 죽었다 — 그 함수는 보스전 중에는
 * 굴리지 않고(`inBoss` 가드), 이제 보스전 밖에는 문제가 없다. 그래서 이벤트가 붙는
 * 시점을 "5문제마다"에서 "보스 등장마다"로 옮긴다. 버프는 그 보스전에 적용된다.
 *
 * `escape`(시간 안에 계단을 올라라)는 제외한다 — 보스전에는 오를 계단이 없고,
 * 계단을 오르는 동안의 시간 압박은 계단 타이머가 이미 담당한다.
 */
export function rollBossEvent(options: {
  floor: number;
  rng: Rng;
  lastId: EventId | null;
}): EventDecision {
  const { floor, rng, lastId } = options;
  if (rng() > EVENT_CHANCE) return { event: null, attempted: true };

  const pool = EVENTS.filter((e) => e.fromFloor <= floor && e.id !== lastId && e.id !== 'escape');
  if (pool.length === 0) return { event: null, attempted: true };

  const total = pool.reduce((sum, e) => sum + e.weight, 0);
  let pick = rng() * total;
  for (const def of pool) {
    pick -= def.weight;
    if (pick <= 0) return { event: def, attempted: true };
  }
  return { event: pool[pool.length - 1], attempted: true };
}

/** 이벤트가 정답 보상에 주는 배수 */
export function rewardMultiplier(active: ActiveEvent | null, answeredFast: boolean): number {
  if (!active) return 1;
  switch (active.def.id) {
    case 'doubleXp':
      return 2;
    case 'mystery':
      return 2;
    case 'goldenWord':
      return 3;
    case 'speed':
      // 시간 안에 맞히면 보너스, 넘겼으면 그냥 정답 — **벌은 없다**
      return answeredFast ? 2 : 1;
    default:
      return 1;
  }
}

/** 이벤트 발생 즉시 주는 골드 (Treasure) */
export function instantGold(def: EventDef, floor: number): number {
  return def.id === 'treasure' ? 20 + Math.floor(floor / 10) * 10 : 0;
}

/** 이 이벤트가 문제 난이도를 올리는지 (Mystery) */
export function difficultyBonus(def: EventDef | null): number {
  return def?.id === 'mystery' ? 0.25 : 0;
}

/** 다음 문제로 넘어갈 때 이벤트 지속 시간을 깎는다 */
export function tickEvent(active: ActiveEvent | null): ActiveEvent | null {
  if (!active) return null;
  const remaining = active.remaining - 1;
  return remaining > 0 ? { ...active, remaining } : null;
}

export function activate(def: EventDef): ActiveEvent {
  return {
    def,
    // 지속형은 여러 문제에 걸쳐 유지되고, 나머지는 그 문제 하나에만 적용된다
    remaining: def.id === 'doubleXp' ? DOUBLE_XP_QUESTIONS : 1,
  };
}
