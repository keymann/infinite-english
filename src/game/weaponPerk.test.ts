import { describe, expect, it } from 'vitest';
import { itemsOf, perkOf, armamentOf } from '../progress/shop';
import { hitBoss, missBoss, openBoss, spawnBoss } from './boss';
import { familyOf, type Armament, type WeaponFamily } from './weaponPerk';

const arm = (family: WeaponFamily | null, bonus = 0): Armament => ({ bonus, family });
const easy = { difficulty: 0.1, combo: 0, answerMs: 9000 };
const dmg = (family: WeaponFamily | null, strike = easy) => hitBoss(spawnBoss(100), strike, arm(family));

describe('무기 계열', () => {
  it('상점 무기 22종 모두 계열이 있다 — 특기 없는 무기가 없다', () => {
    for (const w of itemsOf('weapon')) expect(familyOf(w.asset), w.id).not.toBeNull();
  });

  it('할버드는 창, 마법봉은 지팡이로 묶인다', () => {
    expect(familyOf('halberd')).toBe('spear');
    expect(familyOf('wand_A')).toBe('staff');
  });

  it('장착 정보는 등급 피해와 계열을 함께 담는다', () => {
    expect(armamentOf('dagger_B')).toEqual({ bonus: 4, family: 'dagger' });
    expect(armamentOf(null)).toEqual({ bonus: 0, family: null });
    expect(perkOf(undefined)).toBeNull();
  });
});

describe('특기 — 타격', () => {
  it('맨손과 특기 조건을 못 채운 무기는 피해가 같다', () => {
    const bare = dmg(null).damage;
    for (const f of ['sword', 'axe', 'hammer', 'dagger', 'spear', 'staff', 'fist'] as const) {
      expect(dmg(f).damage, f).toBe(bare);
      expect(dmg(f).perk, f).toBeNull();
    }
  });

  it('검: 콤보 상한이 10 → 15 로 오른다 (상한을 넘길 때만 발동)', () => {
    const strike = { ...easy, combo: 30 };
    expect(dmg('sword', strike).damage - dmg(null, strike).damage).toBe(5);
    expect(dmg('sword', strike).perk).toBe('sword');
    expect(dmg('sword', { ...easy, combo: 8 }).perk).toBeNull();
  });

  it('도끼: 어려운 단어면 +5', () => {
    const hard = { ...easy, difficulty: 0.8 };
    expect(dmg('axe', hard).damage - dmg(null, hard).damage).toBe(5);
    expect(dmg('axe', hard).perk).toBe('axe');
  });

  it('망치: 어려운 단어면 발동하지만 피해는 그대로다 (연출 특기)', () => {
    const hard = { ...easy, difficulty: 0.8 };
    expect(dmg('hammer', hard).perk).toBe('hammer');
    expect(dmg('hammer', hard).damage).toBe(dmg(null, hard).damage);
  });

  it('단검: 3초 안에 맞히면 +4, 넘기면 없다', () => {
    expect(dmg('dagger', { ...easy, answerMs: 2500 }).damage - dmg(null).damage).toBe(4);
    expect(dmg('dagger', { ...easy, answerMs: 3001 }).perk).toBeNull();
  });

  it('활: 보스전 첫 정답만 2배', () => {
    const boss = spawnBoss(100);
    const first = hitBoss(boss, easy, arm('bow'));
    const second = hitBoss(boss, easy, arm('bow'));
    expect(first.damage).toBe(second.damage * 2);
    expect(first.perk).toBe('bow');
    expect(second.perk).toBeNull();
  });

  it('활: 추가분은 +10 까지 — 높은 콤보의 어려운 단어도 +30 이 되지 않는다', () => {
    const big = { difficulty: 0.8, combo: 20, answerMs: 9000 };
    expect(dmg('bow', big).damage - dmg(null, big).damage).toBe(10);
  });

  it('너클: 연속 정답마다 +1, 최대 +5', () => {
    expect(dmg('fist', { ...easy, combo: 3 }).damage - dmg(null, { ...easy, combo: 3 }).damage).toBe(3);
    expect(dmg('fist', { ...easy, combo: 12 }).damage - dmg(null, { ...easy, combo: 12 }).damage).toBe(5);
  });

  it('특기는 정답 한 번에 기본 피해(10)를 넘겨 더하지 않는다 — 무기가 영어를 대신하지 않는다', () => {
    const strikes = [easy, { ...easy, combo: 30 }, { ...easy, difficulty: 0.8 }, { ...easy, answerMs: 1000 }];
    for (const f of ['sword', 'axe', 'hammer', 'dagger', 'bow', 'spear', 'staff', 'fist'] as const) {
      for (const st of strikes) expect(dmg(f, st).damage - dmg(null, st).damage).toBeLessThanOrEqual(10);
    }
  });
});

describe('특기 — 등장', () => {
  it('창: 등장하자마자 10 피해, 그러나 보스를 쓰러뜨리지는 않는다', () => {
    const boss = spawnBoss(10);
    expect(openBoss(boss, 'spear').opener).toBe(10);
    expect(boss.hp).toBe(boss.maxHp - 10);

    const weak = spawnBoss(10);
    weak.hp = 5;
    expect(openBoss(weak, 'spear').opener).toBe(4);
    expect(weak.hp).toBe(1);
  });

  it('지팡이: 흡혈귀의 회복을 막는다', () => {
    const boss = spawnBoss(430, { regen: true });
    expect(openBoss(boss, 'staff').sealed).toBe(true);
    hitBoss(boss, easy);
    expect(missBoss(boss)).toBe(0);
  });

  it('지팡이는 흡혈귀가 아니면 아무것도 하지 않는다', () => {
    expect(openBoss(spawnBoss(10), 'staff')).toEqual({ opener: 0, sealed: false });
  });
});
