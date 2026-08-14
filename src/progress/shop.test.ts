import { describe, expect, it } from 'vitest';

import {
  CHARACTERS,
  availableCharacters,
  purchasedCharacters,
  requiredBundles,
} from './collection';
import {
  SHOP_CATEGORIES,
  SHOP_ITEMS,
  affordable,
  buy,
  itemsOf,
  nextGoal,
  ownedCharacters,
  ownedWeapons,
  shopItem,
} from './shop';

/**
 * 상점 — 카탈로그 · 구매 · 소유.
 *
 * 화면에서 "사기"를 누르는 것은 눈으로 보면 안다. 눈으로 확인하기 어려운 것은 그 아래다:
 * **골드가 정확히 깎이는지 · 같은 것을 두 번 사지 못하는지 · 산 캐릭터가 로비 목록에
 * 실제로 들어오는지.** 그리고 가격 표가 틀리면 아이가 잘못된 목표를 향해 골드를 모은다.
 */

describe('카탈로그', () => {
  it('카테고리는 무기·캐릭터 둘이다', () => {
    expect(SHOP_CATEGORIES.map((c) => c.id)).toEqual(['weapon', 'character']);
  });

  it('무기 22종 · 캐릭터 6종', () => {
    expect(itemsOf('weapon')).toHaveLength(22);
    expect(itemsOf('character')).toHaveLength(6);
  });

  /** 아이가 위에서부터 훑으면 "지금 살 수 있는 것"을 먼저 만나야 한다 */
  it('가격 오름차순으로 나온다', () => {
    for (const category of SHOP_CATEGORIES) {
      const prices = itemsOf(category.id).map((i) => i.price);
      expect([...prices].sort((a, b) => a - b), category.label).toEqual(prices);
    }
  });

  it('id 가 중복되지 않는다', () => {
    expect(new Set(SHOP_ITEMS.map((i) => i.id)).size).toBe(SHOP_ITEMS.length);
  });

  it('요청받은 가격이 그대로 들어갔다', () => {
    const expected: Record<string, number> = {
      sword_A: 1000, staff_A: 1000, wand_A: 1000, fistweapon_A: 1200, spear_A: 1200,
      dagger_A: 1500, axe_A: 1700, hammer_A: 1700, sword_B: 2000, staff_B: 2000,
      halberd: 2000, bow_A: 2000, fistweapon_B: 2400, dagger_B: 3000, sword_C: 3000,
      axe_B: 3400, hammer_B: 3400, bow_B: 3500, sword_D: 4000, sword_E: 5000,
      axe_C: 5000, hammer_C: 5000,
      Barbarian: 5000, Ranger: 6000, Rogue: 7000, Rogue_Hooded: 8000, Knight: 9000, Mage: 10000,
    };
    for (const [id, price] of Object.entries(expected)) {
      expect(shopItem(id)?.price, id).toBe(price);
    }
    // 표에 없는 항목이 몰래 들어 있지 않다
    expect(SHOP_ITEMS.map((i) => i.id).sort()).toEqual(Object.keys(expected).sort());
  });

  /** 화살은 활에 종속된다 — 따로 사는 것은 게임에서 의미가 없다 */
  it('화살은 항목이 아니고 활에 딸려 온다', () => {
    expect(shopItem('arrow_A')).toBeUndefined();
    expect(shopItem('bow_A')?.extra).toBe('arrow_A');
    expect(shopItem('bow_B')?.extra).toBe('arrow_B');
  });

  it('방패는 없다 — 공격 모션에 쓸 수 없다', () => {
    expect(SHOP_ITEMS.filter((i) => i.id.startsWith('shield'))).toEqual([]);
  });

  it('무기는 모델 노드를, 캐릭터는 번들 이름을 가리킨다', () => {
    for (const w of itemsOf('weapon')) expect(w.asset.length, w.id).toBeGreaterThan(0);
    for (const c of itemsOf('character')) expect(c.asset, c.id).toMatch(/^adv-/);
  });

  it('활은 시위가 있는 모델을 쓴다 — 없는 쪽은 부러진 활처럼 보인다', () => {
    expect(shopItem('bow_A')?.asset).toBe('bow_A_withString');
    expect(shopItem('bow_B')?.asset).toBe('bow_B_withString');
  });
});

describe('구매', () => {
  const price = () => shopItem('sword_A')!.price;

  it('가격만큼 골드가 깎인다', () => {
    const r = buy('sword_A', 1500, []);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.gold).toBe(1500 - price());
  });

  it('딱 맞는 골드로도 살 수 있다', () => {
    const r = buy('sword_A', price(), []);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.gold).toBe(0);
  });

  it('골드가 부족하면 못 산다', () => {
    expect(buy('sword_A', price() - 1, [])).toEqual({ ok: false, reason: 'poor' });
  });

  /** 두 번 사면 골드만 사라진다 — 가장 나쁜 버그다 */
  it('이미 가진 것은 다시 사지 못한다', () => {
    expect(buy('sword_A', 99_999, ['sword_A'])).toEqual({ ok: false, reason: 'owned' });
  });

  it('없는 id 는 거절한다 — 저장본이 손상돼도 골드가 빠지지 않는다', () => {
    expect(buy('shield_A', 99_999, [])).toEqual({ ok: false, reason: 'unknown' });
    expect(buy('', 99_999, [])).toEqual({ ok: false, reason: 'unknown' });
  });

  it('상태를 직접 바꾸지 않는다 — 저장·화면 갱신은 부르는 쪽의 일이다', () => {
    const owned: string[] = [];
    buy('sword_A', 5000, owned);
    expect(owned).toEqual([]);
  });
});

describe('소유 목록', () => {
  const owned = ['sword_A', 'Knight', 'bow_B'];

  it('무기와 캐릭터를 나눠 준다 (가격 오름차순)', () => {
    expect(ownedWeapons(owned).map((w) => w.id)).toEqual(['sword_A', 'bow_B']);
    expect(ownedCharacters(owned).map((c) => c.id)).toEqual(['Knight']);
  });

  it('다음 목표는 아직 못 사고 안 가진 것 중 가장 싼 것이다', () => {
    const goal = nextGoal(1000, [])!;
    expect(goal.price).toBeGreaterThan(1000);
    // 이미 전부 가졌으면 목표가 없다
    expect(nextGoal(0, SHOP_ITEMS.map((i) => i.id))).toBeNull();
  });

  it('전부 살 수 있으면 목표가 없다', () => {
    expect(nextGoal(Math.max(...SHOP_ITEMS.map((i) => i.price)), [])).toBeNull();
  });

  it('affordable 은 경계에서 정확하다', () => {
    const sword = shopItem('sword_A')!;
    expect(affordable(sword, sword.price - 1)).toBe(false);
    expect(affordable(sword, sword.price)).toBe(true);
  });
});

describe('산 캐릭터가 로비 목록에 들어온다', () => {
  it('구매 전에는 레벨로 열린 캐릭터만 있다', () => {
    expect(availableCharacters(1, []).every((c) => c.rig === 'kenney')).toBe(true);
  });

  it('구매하면 목록에 추가된다 — 레벨 조건이 없다', () => {
    const knight = availableCharacters(1, ['Knight']).find((c) => c.id === 'Knight');
    expect(knight).toBeTruthy();
    expect(knight!.unlockLevel).toBe(0);
  });

  /**
   * 상점 캐릭터는 클립이 0개다 — 보스와 같은 `Rig_Medium` 이라 `boss-anims` 를 빌려 쓴다.
   * 이 표시가 틀리면 캐릭터가 **T 포즈로 서 있게 된다.**
   */
  it('상점 캐릭터는 rigMedium 으로 표시된다', () => {
    const [knight] = purchasedCharacters(['Knight']);
    expect(knight.rig).toBe('rigMedium');
    expect(knight.bundle).toBe('adv-knight');
    // 번들 하나에 캐릭터 하나뿐이고 노드 이름이 곧 id 다
    expect(knight.node).toBe('Knight');
  });

  it('무기를 사도 캐릭터 목록에는 들어가지 않는다', () => {
    expect(purchasedCharacters(['sword_A'])).toEqual([]);
  });
});

describe('부팅에 필요한 번들 — 캐릭터를 고른 저장본이 열려야 한다', () => {
  /**
   * 이 목록이 틀리면 **첫 화면이 통째로 안 열린다.**
   * 실제로 `bundle 'char-male-b' 을 먼저 load() 해야 한다` 로 깨졌다 —
   * 상점 캐릭터(rigMedium)만 챙기고 레벨 해금 캐릭터를 빠뜨린 탓이었다.
   */
  it('레벨 해금 캐릭터도 자기 번들을 요구한다', () => {
    for (const c of CHARACTERS) {
      expect(requiredBundles(c), c.id).toContain(c.bundle);
    }
  });

  it('상점 캐릭터는 자기 번들 + boss-anims 를 요구한다 — 클립이 0개다', () => {
    for (const c of purchasedCharacters(['Knight', 'Mage'])) {
      expect(requiredBundles(c), c.id).toEqual([c.bundle, 'boss-anims']);
    }
  });

  it('기본 캐릭터는 boss-anims 를 요구하지 않는다 — 첫 로드를 무겁게 하지 않는다', () => {
    expect(requiredBundles(CHARACTERS[0])).toEqual(['player']);
  });

  it('고를 수 있는 모든 캐릭터가 빠짐없이 처리된다', () => {
    const all = availableCharacters(99, ['Knight', 'Barbarian', 'Mage', 'Ranger', 'Rogue', 'Rogue_Hooded']);
    for (const c of all) {
      const need = requiredBundles(c);
      expect(need.length, c.id).toBeGreaterThan(0);
      expect(need[0], c.id).toBe(c.bundle);
    }
  });
});
