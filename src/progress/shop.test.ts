import { describe, expect, it } from 'vitest';

import { SHOP_CATEGORIES, SHOP_ITEMS, affordable, itemsOf, nextGoal } from './shop';

/**
 * 상점 카탈로그.
 *
 * 구매는 아직 없다(UI 만). 그래도 **표시가 틀리면 아이가 잘못된 목표를 향해 골드를 모은다** —
 * "다음 목표"가 이미 살 수 있는 물건을 가리키거나, 카테고리에 아이템이 없거나,
 * 가격이 0 이면 화면이 거짓말을 한다. 그 셋을 고정한다.
 */

describe('상점 카탈로그', () => {
  it('MVP 카테고리는 모자·캐릭터 둘이다', () => {
    expect(SHOP_CATEGORIES.map((c) => c.id)).toEqual(['hat', 'character']);
  });

  it('모든 카테고리에 아이템이 있다 — 빈 목록을 보여 주지 않는다', () => {
    for (const category of SHOP_CATEGORIES) {
      expect(itemsOf(category.id).length, category.label).toBeGreaterThan(0);
    }
  });

  it('모든 아이템이 어느 한 카테고리에 속한다', () => {
    const known = new Set(SHOP_CATEGORIES.map((c) => c.id));
    for (const item of SHOP_ITEMS) expect(known.has(item.category), item.id).toBe(true);
  });

  it('id 가 중복되지 않는다', () => {
    expect(new Set(SHOP_ITEMS.map((i) => i.id)).size).toBe(SHOP_ITEMS.length);
  });

  it('가격은 양수다 — 0 이면 "지금 살 수 있어요" 가 항상 켜진다', () => {
    for (const item of SHOP_ITEMS) expect(item.price, item.id).toBeGreaterThan(0);
  });

  it('이름·설명·이모지가 비어 있지 않다', () => {
    for (const item of SHOP_ITEMS) {
      expect(item.name.length, item.id).toBeGreaterThan(0);
      expect(item.hint.length, item.id).toBeGreaterThan(0);
      expect(item.emoji.length, item.id).toBeGreaterThan(0);
    }
  });
});

describe('표시 계산', () => {
  it('가격만큼 모으면 살 수 있다고 표시한다', () => {
    const item = SHOP_ITEMS[0];
    expect(affordable(item, item.price - 1)).toBe(false);
    expect(affordable(item, item.price)).toBe(true);
    expect(affordable(item, item.price + 1)).toBe(true);
  });

  it('다음 목표는 아직 못 사는 것 중 가장 싼 것이다', () => {
    const cheapest = [...SHOP_ITEMS].sort((a, b) => a.price - b.price)[0];
    expect(nextGoal(0)?.id).toBe(cheapest.id);

    // 가장 싼 것을 살 수 있게 되면 그다음으로 넘어간다
    const goal = nextGoal(cheapest.price)!;
    expect(goal.price).toBeGreaterThan(cheapest.price);
  });

  it('전부 살 수 있으면 다음 목표가 없다', () => {
    const richest = Math.max(...SHOP_ITEMS.map((i) => i.price));
    expect(nextGoal(richest)).toBeNull();
  });
});
