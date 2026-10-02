/**
 * 소비 아이템 — 상점에서 사서 **판 안에서 쓴다.**
 *
 * 무기·캐릭터는 한 번 사면 끝이라, 몇 주를 모으는 동안 판 안에서 골드로 할 일이 없었다.
 * 아이템은 "오늘 모은 골드로 내일 판을 조금 쉽게" 만드는 짧은 목표다.
 *
 * ## 규칙 — 아이템은 영어를 건너뛰게 하지 않는다
 *
 * | 아이템 | 효과 | 언제 |
 * |---|---|---|
 * | 하트 물약 | HP +1 (최대를 넘지 않는다) | 보스전 중, HP 가 줄었을 때 |
 * | 방패 | **방향 실수·가짜 계단 1번을 막는다** | 자동 — 실수하는 순간 |
 * | 별 | 계단 게이지를 가득 채운다 | 계단을 오르는 중 |
 * | 열쇠 | 오답 보기 2개를 지운다. **문제는 그대로 푼다**, 경험치는 절반 | 문제가 떠 있을 때 |
 *
 * - 열쇠를 써도 정답을 골라야 한다. 경험치를 깎는 이유는 "열쇠로 쉽게 경험치 벌기"를 막기 위해서다
 * - 방패는 판이 즉시 끝나는 유일한 조작 실패(PRD 3.2절 뒤집기)의 좌절을 덜어 준다.
 *   판당 1번이라 방향 판단의 긴장은 그대로 남는다
 *
 * 저장·화면은 부르는 쪽의 일이다. 이 파일의 함수는 **새 상태를 돌려줄 뿐** 바꾸지 않는다.
 */

export type ConsumableId = 'potion' | 'shield' | 'star' | 'key';

export type Consumable = {
  id: ConsumableId;
  name: string;
  price: number;
  hint: string;
  /** `items` 번들의 노드 이름 — 상점 썸네일·계단 위 모델 */
  model: string;
  /** 한 판에 쓸 수 있는 횟수 */
  perRun: number;
};

/** 종류마다 가질 수 있는 최대 개수 — 쌓아 두고 한 판을 쉽게 만들지 못하게 한다 */
export const CARRY_MAX = 3;

/**
 * 가격은 하루 골드(보통 실력 약 1,400 — progress/shop.ts)의 10~30%.
 * "판 몇 번이면 하나" 가 되어 무기(1,000~5,000)보다 가까운 목표가 된다.
 */
export const CONSUMABLES: readonly Consumable[] = [
  { id: 'star', name: '별', price: 150, hint: '계단 시간을 가득 채운다', model: 'star', perRun: 2 },
  { id: 'key', name: '열쇠', price: 200, hint: '틀린 보기 2개를 지운다', model: 'key', perRun: 1 },
  { id: 'potion', name: '하트 물약', price: 300, hint: '보스전에서 하트 1개 회복', model: 'potion', perRun: 1 },
  { id: 'shield', name: '방패', price: 400, hint: '방향 실수를 한 번 막는다 (자동)', model: 'shield-round', perRun: 1 },
];

const BY_ID = new Map(CONSUMABLES.map((c) => [c.id, c]));

export function consumable(id: string): Consumable | undefined {
  return BY_ID.get(id as ConsumableId);
}

export function isConsumable(id: string): id is ConsumableId {
  return BY_ID.has(id as ConsumableId);
}

/** 가진 개수 (저장본: `shop.items`) */
export type Inventory = Partial<Record<ConsumableId, number>>;

export function countOf(inv: Inventory, id: ConsumableId): number {
  return Math.max(0, Math.floor(inv[id] ?? 0));
}

export type ItemPurchase =
  | { ok: true; gold: number; inventory: Inventory }
  | { ok: false; reason: 'full' | 'poor' | 'unknown' };

/** 아이템 사기 — 여러 개 살 수 있다 (`CARRY_MAX` 까지) */
export function buyItem(id: string, gold: number, inv: Inventory): ItemPurchase {
  const item = consumable(id);
  if (!item) return { ok: false, reason: 'unknown' };
  if (countOf(inv, item.id) >= CARRY_MAX) return { ok: false, reason: 'full' };
  if (gold < item.price) return { ok: false, reason: 'poor' };
  return { ok: true, gold: gold - item.price, inventory: { ...inv, [item.id]: countOf(inv, item.id) + 1 } };
}

/** 하나를 얻는다 (보스 상자) — 상한을 넘으면 그대로 */
export function grantItem(inv: Inventory, id: ConsumableId): { inventory: Inventory; granted: boolean } {
  if (countOf(inv, id) >= CARRY_MAX) return { inventory: inv, granted: false };
  return { inventory: { ...inv, [id]: countOf(inv, id) + 1 }, granted: true };
}

/** 판 안의 상황 — 아이템을 지금 쓸 수 있는지 판정한다 */
export type ItemContext = {
  /** 계단을 오르는 중 (보스·문제 없음) */
  climbing: boolean;
  /** 문제가 떠 있고 아직 답하지 않았다 */
  quizOpen: boolean;
  inBoss: boolean;
  hp: number;
  maxHp: number;
  /** 이 문제에 이미 열쇠를 썼다 */
  keyUsed: boolean;
};

/**
 * 한 판 동안의 사용 기록. 판을 시작할 때 새로 만든다.
 *
 * 가진 개수(저장본)와 한 판 횟수(`perRun`)를 **둘 다** 본다 — 10개를 가져도 한 판에 1번이다.
 */
export class RunItems {
  private readonly used = new Map<ConsumableId, number>();

  usedCount(id: ConsumableId): number {
    return this.used.get(id) ?? 0;
  }

  /** 이 판에서 남은 횟수 (가진 개수와 한 판 횟수 중 작은 쪽) */
  left(id: ConsumableId, inv: Inventory): number {
    const item = BY_ID.get(id)!;
    return Math.max(0, Math.min(countOf(inv, id), item.perRun - this.usedCount(id)));
  }

  /** 지금 쓸 수 있는지 — 버튼을 켜고 끄는 근거 */
  canUse(id: ConsumableId, inv: Inventory, ctx: ItemContext): boolean {
    if (this.left(id, inv) <= 0) return false;
    switch (id) {
      case 'potion':
        return ctx.inBoss && ctx.hp > 0 && ctx.hp < ctx.maxHp;
      case 'star':
        return ctx.climbing;
      case 'key':
        return ctx.quizOpen && !ctx.keyUsed;
      case 'shield':
        // 방패는 버튼으로 쓰지 않는다 — 실수하는 순간 `absorbMistake` 가 쓴다
        return false;
    }
  }

  /**
   * 하나를 쓴다. 쓸 수 없으면 null.
   * @returns 개수가 줄어든 새 인벤토리
   */
  use(id: ConsumableId, inv: Inventory, ctx: ItemContext): Inventory | null {
    if (!this.canUse(id, inv, ctx)) return null;
    return this.consume(id, inv);
  }

  /**
   * 방향 실수·가짜 계단 — 방패가 있으면 막는다.
   * @returns 막았으면 새 인벤토리, 막지 못했으면 null (판이 끝난다)
   */
  absorbMistake(inv: Inventory): Inventory | null {
    if (this.left('shield', inv) <= 0) return null;
    return this.consume('shield', inv);
  }

  private consume(id: ConsumableId, inv: Inventory): Inventory {
    this.used.set(id, this.usedCount(id) + 1);
    return { ...inv, [id]: countOf(inv, id) - 1 };
  }
}

/**
 * 열쇠: 지울 오답 보기 2개를 고른다.
 *
 * 난수를 받는다 — 늘 앞의 두 개를 지우면 "열쇠를 쓰면 남는 건 뒤쪽" 이라는 요령이 생긴다.
 */
export function keyEliminations(choiceCount: number, correctIndex: number, rng: () => number): number[] {
  const wrong = Array.from({ length: choiceCount }, (_, i) => i).filter((i) => i !== correctIndex);
  for (let i = wrong.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [wrong[i], wrong[j]] = [wrong[j], wrong[i]];
  }
  return wrong.slice(0, Math.min(2, Math.max(0, choiceCount - 2))).sort((a, b) => a - b);
}

/** 보스 상자 — 무엇이 나오는지. 층 번호로 정한다(결정론) */
export type ChestDrop = { kind: 'item'; id: ConsumableId } | { kind: 'gold'; amount: number };

/** 상자에서 아이템이 나올 확률 — 나머지는 골드 */
const CHEST_ITEM_CHANCE = 0.35;
/** 대보스 상자는 아이템이 반드시 나온다 */
const DROP_TABLE: ReadonlyArray<{ id: ConsumableId; weight: number }> = [
  { id: 'star', weight: 4 },
  { id: 'key', weight: 3 },
  { id: 'potion', weight: 2 },
  { id: 'shield', weight: 1 },
];

function hash01(n: number): number {
  let h = Math.imul(n ^ 0x2c1b3c6d, 0x297a2d39);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}

export function chestDrop(floor: number, giant: boolean): ChestDrop {
  if (!giant && hash01(floor) >= CHEST_ITEM_CHANCE) {
    return { kind: 'gold', amount: 15 + Math.floor(floor / 10) * 3 };
  }
  const total = DROP_TABLE.reduce((s, d) => s + d.weight, 0);
  let pick = hash01(floor * 31 + 7) * total;
  for (const d of DROP_TABLE) {
    pick -= d.weight;
    if (pick < 0) return { kind: 'item', id: d.id };
  }
  return { kind: 'item', id: DROP_TABLE[0].id };
}
