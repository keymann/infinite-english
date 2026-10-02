import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  CARRY_MAX,
  CONSUMABLES,
  RunItems,
  buyItem,
  chestDrop,
  grantItem,
  keyEliminations,
  type ItemContext,
} from './items';
import { equippedDamage, nextGoal, weaponDamage } from './shop';

const ctx = (over: Partial<ItemContext> = {}): ItemContext => ({
  climbing: false,
  quizOpen: false,
  inBoss: false,
  hp: 3,
  maxHp: 3,
  keyUsed: false,
  ...over,
});

describe('아이템 구매', () => {
  it('여러 개 살 수 있고 3개에서 멈춘다', () => {
    let inv = {};
    let gold = 10_000;
    for (let i = 0; i < CARRY_MAX; i++) {
      const r = buyItem('star', gold, inv);
      expect(r.ok).toBe(true);
      if (r.ok) ({ gold, inventory: inv } = r);
    }
    expect(buyItem('star', gold, inv)).toEqual({ ok: false, reason: 'full' });
  });

  it('골드가 모자라면 사지 못한다', () => {
    expect(buyItem('shield', 100, {})).toEqual({ ok: false, reason: 'poor' });
  });

  it('아이템은 무기보다 싸다 — 판 몇 번이면 하나 (가장 싼 무기 1,000)', () => {
    for (const c of CONSUMABLES) expect(c.price).toBeLessThan(1000);
  });

  it('아이템은 로비의 "다음 목표" 가 되지 않는다', () => {
    expect(nextGoal(0, [])?.category).not.toBe('item');
  });

  it('모든 아이템 모델이 items 번들에 있다', () => {
    const manifest = JSON.parse(readFileSync('public/models/manifest.json', 'utf8')) as {
      bundles: { name: string; nodes: string[] }[];
    };
    const nodes = manifest.bundles.find((b) => b.name === 'items')!.nodes;
    for (const c of CONSUMABLES) expect(nodes).toContain(c.model);
    expect(nodes).toEqual(expect.arrayContaining(['chest', 'coin']));
  });
});

describe('판 안에서 쓰기', () => {
  it('한 판 횟수를 넘겨 쓸 수 없다 — 10개를 가져도 열쇠는 한 번', () => {
    const run = new RunItems();
    const inv = { key: 3 };
    const after = run.use('key', inv, ctx({ quizOpen: true }));
    expect(after).toEqual({ key: 2 });
    expect(run.use('key', after!, ctx({ quizOpen: true }))).toBeNull();
    expect(run.left('key', after!)).toBe(0);
  });

  it('별은 계단을 오를 때만, 열쇠는 문제가 떠 있을 때만 쓴다', () => {
    const run = new RunItems();
    const inv = { star: 1, key: 1 };
    expect(run.canUse('star', inv, ctx({ quizOpen: true }))).toBe(false);
    expect(run.canUse('star', inv, ctx({ climbing: true }))).toBe(true);
    expect(run.canUse('key', inv, ctx({ climbing: true }))).toBe(false);
    expect(run.canUse('key', inv, ctx({ quizOpen: true, keyUsed: true }))).toBe(false);
  });

  it('물약은 보스전에서 HP 가 줄었을 때만 — REVIVE(HP 0) 는 단어로 넘는다', () => {
    const run = new RunItems();
    const inv = { potion: 1 };
    expect(run.canUse('potion', inv, ctx({ inBoss: true, hp: 3 }))).toBe(false);
    expect(run.canUse('potion', inv, ctx({ inBoss: true, hp: 0 }))).toBe(false);
    expect(run.canUse('potion', inv, ctx({ inBoss: false, hp: 1 }))).toBe(false);
    expect(run.canUse('potion', inv, ctx({ inBoss: true, hp: 1 }))).toBe(true);
  });

  it('방패는 버튼으로 쓰지 않고, 실수를 판당 한 번만 막는다', () => {
    const run = new RunItems();
    const inv = { shield: 2 };
    expect(run.canUse('shield', inv, ctx({ climbing: true }))).toBe(false);
    const after = run.absorbMistake(inv);
    expect(after).toEqual({ shield: 1 });
    expect(run.absorbMistake(after!)).toBeNull();
  });

  it('방패가 없으면 실수를 막지 못한다', () => {
    expect(new RunItems().absorbMistake({})).toBeNull();
  });
});

describe('열쇠 — 보기 지우기', () => {
  it('정답은 지우지 않고, 오답 2개를 지운다', () => {
    for (let correct = 0; correct < 4; correct++) {
      for (const r of [0, 0.3, 0.6, 0.99]) {
        const gone = keyEliminations(4, correct, () => r);
        expect(gone).toHaveLength(2);
        expect(gone).not.toContain(correct);
        expect(new Set(gone).size).toBe(2);
      }
    }
  });

  it('지우는 자리가 늘 같지 않다 — "남는 건 뒤쪽" 요령이 생기지 않게', () => {
    const seen = new Set<string>();
    let seed = 1;
    const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 40; i++) seen.add(keyEliminations(4, 0, rng).join(','));
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe('보스 상자', () => {
  it('같은 층은 같은 상자다 (결정론)', () => {
    for (let floor = 10; floor <= 300; floor += 10) {
      expect(chestDrop(floor, false)).toEqual(chestDrop(floor, false));
    }
  });

  it('대보스 상자는 늘 아이템이다', () => {
    for (let floor = 50; floor <= 1000; floor += 50) expect(chestDrop(floor, true).kind).toBe('item');
  });

  it('일반 상자는 골드와 아이템이 섞여 나온다', () => {
    const kinds = new Set<string>();
    for (let floor = 10; floor <= 500; floor += 10) kinds.add(chestDrop(floor, false).kind);
    expect(kinds).toEqual(new Set(['gold', 'item']));
  });

  it('가득 찬 아이템은 더 주지 않는다', () => {
    expect(grantItem({ star: CARRY_MAX }, 'star').granted).toBe(false);
    expect(grantItem({}, 'star')).toEqual({ inventory: { star: 1 }, granted: true });
  });
});

describe('무기 공격력', () => {
  it('가격 등급에 따라 +1 ~ +5', () => {
    expect(weaponDamage(1000)).toBe(1);
    expect(weaponDamage(1200)).toBe(2);
    expect(weaponDamage(2000)).toBe(3);
    expect(weaponDamage(3400)).toBe(4);
    expect(weaponDamage(5000)).toBe(5);
  });

  it('장착하지 않았거나 캐릭터 id 면 0', () => {
    expect(equippedDamage(null)).toBe(0);
    expect(equippedDamage('Knight')).toBe(0);
    expect(equippedDamage('sword_E')).toBe(5);
  });
});
