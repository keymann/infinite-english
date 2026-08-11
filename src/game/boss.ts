/**
 * 보스전 (PRD 18·19장).
 *
 * 일반 구간은 "1문제 = 계단 몇 칸"이다. 보스전은 규칙을 바꾼다 —
 * **계단이 열리지 않고, 정답이 보스 HP 를 깎는다.** 같은 문제를 푸는데 의미가 달라진다.
 * 한 판의 기승전결에서 '전'에 해당한다 (Phase 7 완료 기준).
 *
 * ```
 * 20층 도달 → 보스 등장 → 정답마다 HP -10 (어려운 단어 -20)
 *          → 10~15문제로 처치 → 보물상자 → 계단 다시 열림
 *          └ 오답 → HP -1 (일반과 같다) + 보스가 공격 연출
 * ```
 *
 * **약점 단어를 집중 출제한다.** 보스전이 곧 "자주 틀리는 단어 복습 구간"이 되도록
 * 설계한 것이다 — 아이는 보스를 잡으려고 자기가 약한 단어를 반복한다.
 * 단, 같은 단어를 연달아 내지는 않는다 (PRD 19장).
 */

/** 몇 층마다 보스가 나오는지 */
export const BOSS_EVERY = 20;

/**
 * 보스 사이 최소 문제 수.
 *
 * 콤보가 최고조인 플레이어는 **한 문제에 4칸**을 오른다 — 20층이면 5문제다.
 * 층 조건만 두면 5~6문제마다 보스를 만나고, 보스전이 8~10문제이므로 판 전체가
 * 보스전이 되어 버린다(실측에서 그렇게 됐다). 계단을 오르는 리듬이 주인공이므로
 * 보스는 문제 수로도 간격을 둔다.
 */
export const BOSS_MIN_GAP_QUESTIONS = 10;

/** 보스를 지금 낼 수 있는지 — 층 조건과 간격 조건을 모두 본다 */
export function canSpawnBoss(options: {
  floor: number;
  lastBossFloor: number;
  asked: number;
  lastBossAsked: number;
}): boolean {
  const { floor, lastBossFloor, asked, lastBossAsked } = options;
  const milestone = Math.floor(floor / BOSS_EVERY) * BOSS_EVERY;
  if (milestone <= lastBossFloor || !isBossFloor(milestone)) return false;
  return asked - lastBossAsked >= BOSS_MIN_GAP_QUESTIONS;
}

/** 보스 최대 HP — 기본 데미지 10 이면 10~15문제 */
const BOSS_HP = 120;
/** 정답 데미지 */
const DAMAGE_BASE = 10;
/** 고난도 단어(난이도 0.5 이상) 정답 데미지 */
const DAMAGE_HARD = 20;
/** 콤보 보너스 상한 */
const DAMAGE_COMBO_MAX = 10;

export type BossState = {
  /** 몇 번째 보스인지 (1부터) */
  index: number;
  hp: number;
  maxHp: number;
  /** 보스전에서 낸 문제 수 */
  asked: number;
};

export function isBossFloor(floor: number): boolean {
  return floor > 0 && floor % BOSS_EVERY === 0;
}

export function spawnBoss(floor: number): BossState {
  const index = Math.floor(floor / BOSS_EVERY);
  // 두 번째 보스부터 조금 더 단단해진다. 하지만 문제 수로는 크게 늘리지 않는다 —
  // 보스전이 길어지면 계단을 오르는 재미가 끊긴다
  const maxHp = BOSS_HP + (index - 1) * 20;
  return { index, hp: maxHp, maxHp, asked: 0 };
}

export type BossHit = {
  damage: number;
  hp: number;
  /** 이번 정답으로 처치했는지 */
  defeated: boolean;
  /** 고난도 단어로 큰 피해를 줬는지 — 연출을 다르게 한다 */
  critical: boolean;
};

/** 정답 → 보스 HP 감소 */
export function hitBoss(boss: BossState, difficulty: number, combo: number): BossHit {
  const critical = difficulty >= 0.5;
  const damage =
    (critical ? DAMAGE_HARD : DAMAGE_BASE) + Math.min(DAMAGE_COMBO_MAX, Math.floor(combo / 2));
  const hp = Math.max(0, boss.hp - damage);
  boss.hp = hp;
  boss.asked++;
  return { damage, hp, defeated: hp === 0, critical };
}

/** 오답 → 보스전에서도 문제 수는 센다 (통계·연출용) */
export function missBoss(boss: BossState) {
  boss.asked++;
}

export function hpRatio(boss: BossState): number {
  return boss.hp / boss.maxHp;
}

/** 처치 보상 — 보물상자 (PRD 14장) */
export function bossReward(boss: BossState): { gold: number; exp: number } {
  return { gold: 40 + boss.index * 20, exp: 60 + boss.index * 30 };
}
