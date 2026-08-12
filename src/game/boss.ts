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

/**
 * 몇 층마다 보스가 나오는지.
 *
 * 20층 → **10층으로 줄였다.** 문제를 계단 구간마다 조금씩 내는 대신 보스전에 모으는
 * 구조로 바꿨다 (요구 사항 1). 계단 구간은 4~12칸으로 길어져 오르는 동안 끊기지 않고,
 * 문제는 보스 앞에서 몰아서 나온다.
 */
export const BOSS_EVERY = 10;

/**
 * 보스를 지금 낼 수 있는지 — **층 조건만 본다.**
 *
 * 이전에는 "보스 사이 최소 문제 수" 조건이 함께 있었다. 한 정답이 계단 12칸을 열던 때는
 * 한 구간에 보스 층을 두 번 지나쳐 보스가 연달아 등장할 수 있었기 때문이다.
 *
 * **그 조건을 제거했다.** 문제를 보스전에서만 내게 되면서 계단을 오르는 동안 `asked` 가
 * 늘지 않는다 — 첫 보스(10층)에서 `asked - lastBossAsked = 0` 이라 간격을 영원히 채우지
 * 못하고 **보스가 한 번도 나오지 않았다.** 이제 한 칸씩 오르므로 각 보스 층을 정확히
 * 한 번만 지나가고, `lastBossFloor` 만으로 중복이 막힌다.
 */
export function canSpawnBoss(options: { floor: number; lastBossFloor: number }): boolean {
  const { floor, lastBossFloor } = options;
  const milestone = Math.floor(floor / BOSS_EVERY) * BOSS_EVERY;
  return milestone > lastBossFloor && isBossFloor(milestone);
}

/** 다음 보스가 기다리는 층 — 등반 중 "어디까지 오르면 되는지" 를 화면에 보여 준다 */
export function nextBossFloor(floor: number): number {
  return (Math.floor(floor / BOSS_EVERY) + 1) * BOSS_EVERY;
}

/** 첫 보스의 최대 HP — 기본 데미지 10 이면 12문제 */
const BOSS_HP = 120;
/**
 * 보스 하나당 늘어나는 HP.
 *
 * **보스가 어려워지는 만큼 체력도 늘어난다** = 낼 문제 수가 늘어난다 (요구 사항 1).
 * 층이 오르면 출제 난이도(adaptive)도 함께 올라가므로, 체력만 늘려도 "어려운 문제를
 * 더 많이" 푸는 구간이 된다.
 */
const BOSS_HP_STEP = 25;
/**
 * HP 상한.
 *
 * 없으면 100층대 보스가 400 HP(40문제)가 되어 한 보스전이 판 전체보다 길어진다.
 *
 * **240 은 시뮬레이션으로 고른 값이다.** 320 과 비교했을 때 (200문항 × 40회, 정답률 78%)
 * 도달 층 124층 → **140층**, 보스전 평균 19.9문제 → **17.9문제** — 층수는 높아지고
 * 보스전은 짧아졌다. 그러면서도 100층 보스의 체력은 변경 전(200)보다 여전히 높다.
 */
const BOSS_HP_MAX = 240;
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
  const index = Math.max(1, Math.floor(floor / BOSS_EVERY));
  const maxHp = Math.min(BOSS_HP_MAX, BOSS_HP + (index - 1) * BOSS_HP_STEP);
  return { index, hp: maxHp, maxHp, asked: 0 };
}

/** 이 보스를 잡는 데 필요한 최소 정답 수 — 밸런스 확인·테스트용 */
export function questionsToDefeat(boss: BossState, damagePerHit = DAMAGE_BASE): number {
  return Math.ceil(boss.maxHp / damagePerHit);
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
