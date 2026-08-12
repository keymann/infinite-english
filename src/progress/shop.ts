/**
 * 상점 — **MVP 는 UI 만이다.**
 *
 * 요청 그대로 화면과 목록만 만들고 구매는 "추가 예정"으로 표기한다. 그래서 이 파일에는
 * 카탈로그와 표시용 계산만 있고 **구매 함수가 없다** — 아직 없는 기능을 위한 코드를
 * 미리 써 두면, 나중에 실제 요구와 어긋난 채로 남아 있게 된다.
 *
 * ## 화폐는 골드다 (점수가 아니다)
 *
 * 요청은 "게임을 하여 획득한 점수로" 였다. 하지만 이 게임의 **점수(score)는 판마다
 * 0 으로 초기화된다** — 판이 끝나면 사라지므로 상점 화폐가 될 수 없다.
 * 판을 넘어 누적되는 것은 **골드**이고(정답·체크포인트·보스·미션으로 얻는다),
 * 그것이 "게임을 해서 모은 것"이라는 요청의 뜻에 맞는다. 골드는 이미 로비에 표시된다.
 *
 * ## 잠금 방식이 두 갈래가 된다
 *
 * 기존 캐릭터·펫은 **레벨로 해금**된다(progress/collection.ts). 상점이 들어오면
 * 같은 종류의 물건에 잠금 규칙이 두 개 생긴다. 실제 구매를 구현할 때 정리해야 한다 —
 * 지금은 상점 캐릭터를 컬렉션과 **별개 항목**으로 두어 충돌을 만들지 않는다.
 */

export type ShopCategory = 'hat' | 'character';

export type ShopItem = {
  id: string;
  name: string;
  category: ShopCategory;
  /** 골드 가격 — 표시용. 실제 차감은 아직 없다 */
  price: number;
  /** 한 줄 설명 */
  hint: string;
  /** 아이콘 대신 쓰는 이모지 — 3D 모델이 붙기 전까지 */
  emoji: string;
};

export const SHOP_CATEGORIES: ReadonlyArray<{ id: ShopCategory; label: string; hint: string }> = [
  { id: 'hat', label: '모자', hint: '머리에 쓰는 것' },
  { id: 'character', label: '캐릭터', hint: '함께 오를 친구' },
] as const;

export const SHOP_ITEMS: readonly ShopItem[] = [
  { id: 'hat-wizard', name: '마법사 모자', category: 'hat', price: 300, hint: '별이 반짝인다', emoji: '🧙' },
  { id: 'hat-crown', name: '황금 왕관', category: 'hat', price: 800, hint: '100층을 넘은 자의 것', emoji: '👑' },
  { id: 'hat-cap', name: '탐험가 모자', category: 'hat', price: 150, hint: '가볍고 튼튼하다', emoji: '🧢' },
  { id: 'hat-helmet', name: '기사 투구', category: 'hat', price: 500, hint: '보스도 무섭지 않다', emoji: '⛑️' },
  { id: 'char-knight', name: '꼬마 기사', category: 'character', price: 1000, hint: '방패를 들고 오른다', emoji: '🛡️' },
  { id: 'char-ninja', name: '그림자 닌자', category: 'character', price: 1200, hint: '계단을 가볍게 뛴다', emoji: '🥷' },
] as const;

export function itemsOf(category: ShopCategory): readonly ShopItem[] {
  return SHOP_ITEMS.filter((item) => item.category === category);
}

/**
 * 그 아이템을 살 만큼 모았는지 — **표시용**이다.
 *
 * 구매가 아직 없으므로 이 값은 "얼마나 남았는지"를 보여 주는 데만 쓴다.
 * 목표가 보이면 골드를 모을 이유가 생긴다 (PRD 35장: 보상이 게임 액션으로 보이게).
 */
export function affordable(item: ShopItem, gold: number): boolean {
  return gold >= item.price;
}

/** 가장 가까운 목표 — 로비에 "다음 목표"로 보여 준다 */
export function nextGoal(gold: number): ShopItem | null {
  const locked = SHOP_ITEMS.filter((item) => item.price > gold).sort((a, b) => a.price - b.price);
  return locked[0] ?? null;
}
