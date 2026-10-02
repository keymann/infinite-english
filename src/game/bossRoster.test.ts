import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bossReward, hitBoss, missBoss, spawnBoss, BOSS_EVERY } from './boss';
import { BOSS_KINDS, GIANT_EVERY, bossBundles, bossFor, isGiantFloor, type BossKind } from './bossRoster';

/** 파이프라인이 만든 번들 목록 — 로스터가 없는 번들·노드를 가리키면 보스전이 깨진다 */
const manifest = JSON.parse(readFileSync('public/models/manifest.json', 'utf8')) as {
  bundles: { name: string; nodes: string[]; counts: { animations: number } }[];
};
const bundle = (name: string) => manifest.bundles.find((b) => b.name === name);
const kinds = Object.values(BOSS_KINDS) as BossKind[];

describe('보스 로스터', () => {
  it('같은 층에는 늘 같은 보스가 나온다 (결정론)', () => {
    for (let floor = BOSS_EVERY; floor <= 700; floor += BOSS_EVERY) {
      expect(bossFor(floor)).toEqual(bossFor(floor));
    }
  });

  it('일반 보스는 연달아 같은 종이 나오지 않는다', () => {
    let prev = '';
    for (let floor = BOSS_EVERY; floor <= 700; floor += BOSS_EVERY) {
      const { kind, giant } = bossFor(floor);
      if (!giant) expect(kind.id).not.toBe(prev);
      prev = giant ? '' : kind.id;
    }
  });

  it('50층마다 대보스가 나오고 그 사이에는 나오지 않는다', () => {
    expect(isGiantFloor(GIANT_EVERY)).toBe(true);
    expect(bossFor(50).giant).toBe(true);
    expect(bossFor(100).giant).toBe(true);
    expect(bossFor(40).giant).toBe(false);
    expect(bossFor(60).giant).toBe(false);
  });

  it('첫 100층에서 보스 종이 3가지 이상 나온다 — 세 번째 보스가 배경이 되지 않게', () => {
    const ids = new Set<string>();
    for (let floor = BOSS_EVERY; floor < 100; floor += BOSS_EVERY) ids.add(bossFor(floor).kind.id);
    expect(ids.size).toBeGreaterThanOrEqual(3);
  });

  it('구간이 바뀌면 무리도 바뀐다 (숲 ≠ 설산)', () => {
    expect(bossFor(10).kind.id).not.toBe(bossFor(310).kind.id);
  });

  it('로스터의 모든 번들·노드·무기가 에셋에 있다', () => {
    const gear = bundle('boss-gear');
    expect(gear).toBeDefined();
    for (const kind of kinds) {
      const b = bundle(kind.bundle);
      expect(b, kind.bundle).toBeDefined();
      expect(b!.nodes).toContain(kind.node);
      // Kenney 몬스터는 클립을 자기 glb 에 갖고 있어야 한다 (boss-anims 를 쓰지 않는다)
      if (kind.rig === 'kenney') expect(b!.counts.animations).toBeGreaterThan(0);
      for (const node of [kind.gear?.right, kind.gear?.left]) {
        if (node) expect(gear!.nodes).toContain(node);
      }
    }
    expect(bossBundles().length).toBe(new Set(kinds.map((k) => k.bundle)).size);
  });
});

describe('대보스 · 특성 · 무기', () => {
  it('대보스는 HP 1.5배, 보상 2배다', () => {
    const normal = spawnBoss(50);
    const giant = spawnBoss(50, { giant: true });
    expect(giant.maxHp).toBe(Math.round(normal.maxHp * 1.5));
    expect(bossReward(giant).gold).toBe(bossReward(normal).gold * 2);
  });

  it('흡혈귀는 오답에 체력을 조금 찬다 — 정답 한 번보다 적게', () => {
    const boss = spawnBoss(400, { regen: true });
    hitBoss(boss, 0.1, 0);
    hitBoss(boss, 0.1, 0);
    const before = boss.hp;
    const heal = missBoss(boss);
    expect(heal).toBeGreaterThan(0);
    expect(heal).toBeLessThan(10);
    expect(boss.hp).toBe(before + heal);
  });

  it('대보스 흡혈귀도 정답 한 번보다 적게 회복한다', () => {
    const boss = spawnBoss(400, { regen: true, giant: true });
    hitBoss(boss, 0.1, 0);
    hitBoss(boss, 0.1, 0);
    expect(missBoss(boss)).toBeLessThan(10);
  });

  it('회복은 최대 HP 를 넘지 않고, 특성이 없으면 회복하지 않는다', () => {
    const full = spawnBoss(400, { regen: true });
    expect(missBoss(full)).toBe(0);
    expect(full.hp).toBe(full.maxHp);
    const plain = spawnBoss(400);
    hitBoss(plain, 0.1, 0);
    expect(missBoss(plain)).toBe(0);
  });

  it('무기 보너스만큼 피해가 늘어난다', () => {
    const a = hitBoss(spawnBoss(20), 0.1, 0, 0).damage;
    const b = hitBoss(spawnBoss(20), 0.1, 0, 5).damage;
    expect(b - a).toBe(5);
  });
});
