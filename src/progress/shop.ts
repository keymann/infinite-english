/**
 * 상점 — 무기와 캐릭터를 골드로 산다.
 *
 * ## 화폐는 골드다 (점수가 아니다)
 *
 * 요청은 "게임을 하여 획득한 점수로" 였다. 하지만 이 게임의 **점수(score)는 판마다 0 으로
 * 초기화된다** — 판이 끝나면 사라지므로 상점 화폐가 될 수 없다. 판을 넘어 누적되는 것은
 * **골드**이고(정답 3 · 체크포인트 · 크리스탈 · 보스 처치 · Treasure · 일일 미션),
 * 그것이 "게임을 해서 모은 것"이라는 요청의 뜻에 맞는다.
 *
 * ## 가격은 시뮬레이션 위에서 정해졌다
 *
 * 실제 골드 함수로 5판(하루)을 돌린 결과: 보통 실력 약 1,400골드 / 익숙해지면 4,600골드.
 * 100층 완주 1판은 2,465골드다(그중 61% 가 보스 처치). 그래서 무기 1,000~5,000 은
 * "첫날~며칠", 캐릭터 5,000~10,000 은 "몇 주"의 목표가 된다.
 *
 * ## 화살은 항목이 아니다
 *
 * `arrow_A`·`arrow_B` 는 상점에 없다. 활에 **종속**되어 활을 장착하면 함께 들린다 —
 * 화살만 따로 사는 것은 게임에서 의미가 없다.
 */

export type ShopCategory = 'weapon' | 'character';

export type ShopItem = {
  id: string;
  name: string;
  category: ShopCategory;
  /** 골드 가격 */
  price: number;
  /** 한 줄 설명 */
  hint: string;
  /** 3D 모델이 화면에 붙기 전까지 목록에서 쓰는 이모지 */
  emoji: string;
  /**
   * 무기: `weapons` 번들의 노드 이름.
   * 캐릭터: 번들 이름 (`adv-knight` 등) — 캐릭터는 번들 하나에 하나뿐이다.
   */
  asset: string;
  /** 활처럼 함께 붙는 부속 모델 (화살) */
  extra?: string;
};

export const SHOP_CATEGORIES: ReadonlyArray<{ id: ShopCategory; label: string; hint: string }> = [
  { id: 'weapon', label: '무기', hint: '보스를 공격할 때 든다' },
  { id: 'character', label: '캐릭터', hint: '함께 계단을 오를 친구' },
] as const;

/**
 * 무기 22종. 가격은 요청받은 값이다.
 *
 * 목록은 **가격 오름차순**으로 보여 준다 (`itemsOf` 가 정렬한다) — 아이가 위에서부터
 * "지금 살 수 있는 것"을 만나야 한다.
 */
const WEAPONS: readonly ShopItem[] = [
  { id: 'sword_A', name: '낡은 검', price: 1000, hint: '가장 먼저 잡는 검', emoji: '🗡️', asset: 'sword_A', category: 'weapon' },
  { id: 'staff_A', name: '나무 지팡이', price: 1000, hint: '가볍고 단단하다', emoji: '🪄', asset: 'staff_A', category: 'weapon' },
  { id: 'wand_A', name: '마법봉', price: 1000, hint: '끝에 작은 빛이 있다', emoji: '✨', asset: 'wand_A', category: 'weapon' },
  { id: 'fistweapon_A', name: '가죽 너클', price: 1200, hint: '주먹으로 싸운다', emoji: '🥊', asset: 'fistweapon_A', category: 'weapon' },
  { id: 'spear_A', name: '창', price: 1200, hint: '멀리 있는 보스도 닿는다', emoji: '🔱', asset: 'spear_A', category: 'weapon' },
  { id: 'dagger_A', name: '단검', price: 1500, hint: '빠르게 찌른다', emoji: '🔪', asset: 'dagger_A', category: 'weapon' },
  { id: 'axe_A', name: '손도끼', price: 1700, hint: '한 손으로 내려친다', emoji: '🪓', asset: 'axe_A', category: 'weapon' },
  { id: 'hammer_A', name: '망치', price: 1700, hint: '무겁게 두드린다', emoji: '🔨', asset: 'hammer_A', category: 'weapon' },
  { id: 'sword_B', name: '기사의 검', price: 2000, hint: '날이 곧다', emoji: '⚔️', asset: 'sword_B', category: 'weapon' },
  { id: 'staff_B', name: '수정 지팡이', price: 2000, hint: '끝에 수정이 박혔다', emoji: '🔮', asset: 'staff_B', category: 'weapon' },
  { id: 'halberd', name: '할버드', price: 2000, hint: '도끼와 창을 합쳤다', emoji: '🏹', asset: 'halberd', category: 'weapon' },
  { id: 'bow_A', name: '나무 활', price: 2000, hint: '화살이 함께 온다', emoji: '🏹', asset: 'bow_A_withString', extra: 'arrow_A', category: 'weapon' },
  { id: 'fistweapon_B', name: '강철 너클', price: 2400, hint: '주먹이 무거워진다', emoji: '🥊', asset: 'fistweapon_B', category: 'weapon' },
  { id: 'dagger_B', name: '쌍날 단검', price: 3000, hint: '양쪽에 날이 있다', emoji: '🔪', asset: 'dagger_B', category: 'weapon' },
  { id: 'sword_C', name: '긴 검', price: 3000, hint: '두 손으로 잡는다', emoji: '⚔️', asset: 'sword_C', category: 'weapon' },
  { id: 'axe_B', name: '전투 도끼', price: 3400, hint: '한 번에 크게 벤다', emoji: '🪓', asset: 'axe_B', category: 'weapon' },
  { id: 'hammer_B', name: '전투 망치', price: 3400, hint: '땅이 울린다', emoji: '🔨', asset: 'hammer_B', category: 'weapon' },
  { id: 'bow_B', name: '강궁', price: 3500, hint: '멀리, 세게', emoji: '🏹', asset: 'bow_B_withString', extra: 'arrow_B', category: 'weapon' },
  { id: 'sword_D', name: '용사의 검', price: 4000, hint: '빛을 반사한다', emoji: '⚔️', asset: 'sword_D', category: 'weapon' },
  { id: 'sword_E', name: '전설의 검', price: 5000, hint: '가장 강한 검', emoji: '⚔️', asset: 'sword_E', category: 'weapon' },
  { id: 'axe_C', name: '거대 도끼', price: 5000, hint: '한 방이면 끝난다', emoji: '🪓', asset: 'axe_C', category: 'weapon' },
  { id: 'hammer_C', name: '거대 망치', price: 5000, hint: '보스가 뒤로 밀린다', emoji: '🔨', asset: 'hammer_C', category: 'weapon' },
];

/** 캐릭터 6종 (KayKit Adventurers). `asset` 은 번들 이름이다 */
const CHARACTERS: readonly ShopItem[] = [
  { id: 'Barbarian', name: '야만전사', price: 5000, hint: '힘으로 밀어 올린다', emoji: '🪓', asset: 'adv-barbarian', category: 'character' },
  { id: 'Ranger', name: '궁수', price: 6000, hint: '멀리 보고 걷는다', emoji: '🏹', asset: 'adv-ranger', category: 'character' },
  { id: 'Rogue', name: '도적', price: 7000, hint: '가볍게 계단을 뛴다', emoji: '🗝️', asset: 'adv-rogue', category: 'character' },
  { id: 'Rogue_Hooded', name: '두건 쓴 도적', price: 8000, hint: '그림자에 섞인다', emoji: '🥷', asset: 'adv-rogue-hooded', category: 'character' },
  { id: 'Knight', name: '기사', price: 9000, hint: '갑옷이 단단하다', emoji: '🛡️', asset: 'adv-knight', category: 'character' },
  { id: 'Mage', name: '마법사', price: 10000, hint: '가장 먼 곳까지 오른다', emoji: '🧙', asset: 'adv-mage', category: 'character' },
];

export const SHOP_ITEMS: readonly ShopItem[] = [...WEAPONS, ...CHARACTERS];

const BY_ID = new Map(SHOP_ITEMS.map((i) => [i.id, i]));

export function shopItem(id: string): ShopItem | undefined {
  return BY_ID.get(id);
}

/** 그 카테고리의 아이템 — **가격 오름차순** */
export function itemsOf(category: ShopCategory): readonly ShopItem[] {
  return SHOP_ITEMS.filter((item) => item.category === category).sort((a, b) => a.price - b.price);
}

/** 살 만큼 모았는지 */
export function affordable(item: ShopItem, gold: number): boolean {
  return gold >= item.price;
}

/** 가장 가까운 목표 — 로비에 "다음 목표"로 보여 준다 */
export function nextGoal(gold: number, owned: readonly string[]): ShopItem | null {
  const locked = SHOP_ITEMS.filter((item) => item.price > gold && !owned.includes(item.id)).sort(
    (a, b) => a.price - b.price,
  );
  return locked[0] ?? null;
}

export type PurchaseResult =
  | { ok: true; gold: number }
  | { ok: false; reason: 'owned' | 'poor' | 'unknown' };

/**
 * 구매 — 골드를 깎고 소유 목록에 넣는다.
 *
 * **상태를 직접 바꾸지 않고 결과를 돌려준다.** 저장·화면 갱신은 부르는 쪽의 일이고,
 * 그래야 이 함수를 시간·저장소 없이 테스트할 수 있다.
 */
export function buy(id: string, gold: number, owned: readonly string[]): PurchaseResult {
  const item = BY_ID.get(id);
  if (!item) return { ok: false, reason: 'unknown' };
  if (owned.includes(id)) return { ok: false, reason: 'owned' };
  if (gold < item.price) return { ok: false, reason: 'poor' };
  return { ok: true, gold: gold - item.price };
}

/** 소유한 무기들 (가격 오름차순) */
export function ownedWeapons(owned: readonly string[]): readonly ShopItem[] {
  return itemsOf('weapon').filter((w) => owned.includes(w.id));
}

/** 소유한 캐릭터들 (가격 오름차순) */
export function ownedCharacters(owned: readonly string[]): readonly ShopItem[] {
  return itemsOf('character').filter((c) => owned.includes(c.id));
}
