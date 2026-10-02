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

import {
  AXE_CRIT_BONUS,
  BOW_FIRST_MULT,
  BOW_MAX_EXTRA,
  DAGGER_BONUS,
  DAGGER_FAST_MS,
  FIST_MAX,
  SPEAR_OPENER,
  SWORD_COMBO_CAP_BONUS,
  type Armament,
  type WeaponFamily,
} from './weaponPerk';

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

/**
 * 첫 보스의 최대 HP — 기본 데미지 10 이면 **6문제**.
 *
 * 120 → 60 으로 **절반으로 줄였다.** 문제를 보스전에만 모으자 한 보스전이 평균 18문제
 * (약 2분)가 되어 계단을 오르는 시간보다 훨씬 길어졌다. 보스는 관문이어야 하고
 * 시험이 되어서는 안 된다.
 */
const BOSS_HP = 60;
/**
 * 보스 하나당 늘어나는 HP.
 *
 * **보스가 어려워지는 만큼 체력도 늘어난다** = 낼 문제 수가 늘어난다 (요구 사항 1).
 * 층이 오르면 출제 난이도(adaptive)도 함께 올라가므로, 체력만 늘려도 "어려운 문제를
 * 더 많이" 푸는 구간이 된다.
 */
const BOSS_HP_STEP = 12;
/**
 * HP 상한 — 기본 데미지 10 이면 **12문제**.
 *
 * 240 → 120 으로 절반. 상한이 필요한 이유는 그대로다: 없으면 100층대 보스가 계속
 * 두꺼워져 한 보스전이 판 전체보다 길어진다.
 */
const BOSS_HP_MAX = 120;
/** 정답 데미지 */
const DAMAGE_BASE = 10;
/** 고난도 단어(난이도 0.5 이상) 정답 데미지 */
const DAMAGE_HARD = 20;
/** 콤보 보너스 상한 */
const DAMAGE_COMBO_MAX = 10;
/** 대보스 HP 배수 — 일반 보스의 1.5배 */
const GIANT_HP = 1.5;
/**
 * 흡혈귀(`regen`)가 오답 한 번에 회복하는 양 (최대 HP 대비).
 *
 * 정답 한 번(10)보다 작아야 한다. 같거나 크면 틀린 만큼 다시 맞혀도 제자리라 아이가 지친다.
 * 그래서 `REGEN_MAX` 로 상한을 둔다 — 비율만 쓰면 대보스(HP 180)에서 11 이 된다.
 */
const REGEN_RATIO = 0.06;
const REGEN_MAX = DAMAGE_BASE - 2;

export type BossState = {
  /** 몇 번째 보스인지 (1부터) */
  index: number;
  hp: number;
  maxHp: number;
  /** 보스전에서 낸 문제 수 */
  asked: number;
  /** 대보스인지 (50층마다 — game/bossRoster.ts) */
  giant: boolean;
  /** 오답이면 HP 를 회복하는지 (흡혈귀). 지팡이를 들면 꺼진다 */
  regen: boolean;
  /** 이 보스에게 맞힌 정답 수 — 활의 "첫 정답 2배" 판정 */
  hits: number;
};

export type SpawnOptions = {
  giant?: boolean;
  regen?: boolean;
};

export function isBossFloor(floor: number): boolean {
  return floor > 0 && floor % BOSS_EVERY === 0;
}

/**
 * 보스를 세운다. 종·등급은 `bossRoster.bossFor` 가 정하고, 여기서는 수치만 만든다.
 *
 * 대보스는 상한을 넘어 1.5배까지 두꺼워진다. 50층마다 한 번이라 판 전체를 늘리지 않는다.
 */
export function spawnBoss(floor: number, options: SpawnOptions = {}): BossState {
  const index = Math.max(1, Math.floor(floor / BOSS_EVERY));
  const base = Math.min(BOSS_HP_MAX, BOSS_HP + (index - 1) * BOSS_HP_STEP);
  const giant = options.giant ?? false;
  const maxHp = giant ? Math.round(base * GIANT_HP) : base;
  return { index, hp: maxHp, maxHp, asked: 0, giant, regen: options.regen ?? false, hits: 0 };
}

/** 보스가 등장할 때 무기 특기가 바꾼 것 — 연출이 알려 준다 */
export type BossOpening = {
  /** 창: 등장하자마자 준 피해 (없으면 0) */
  opener: number;
  /** 지팡이: 흡혈귀의 회복을 막았는지 */
  sealed: boolean;
};

/**
 * 등장 직후 무기 특기를 적용한다 — 창(선제 피해)·지팡이(회복 봉인).
 *
 * 선제 피해로 보스를 쓰러뜨리지는 않는다(HP 1 은 남긴다). 보스전은 영어로 끝나야 한다.
 */
export function openBoss(boss: BossState, family: WeaponFamily | null): BossOpening {
  let opener = 0;
  let sealed = false;
  if (family === 'spear') {
    opener = Math.min(SPEAR_OPENER, boss.hp - 1);
    boss.hp -= opener;
  }
  if (family === 'staff' && boss.regen) {
    boss.regen = false;
    sealed = true;
  }
  return { opener, sealed };
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
  /** 이번 타격에서 무기 특기가 발동했는지 — 연출을 키우고 특기 이름을 띄운다 */
  perk: WeaponFamily | null;
};

/** 정답 한 번의 상황 — 무기 특기 판정에 필요한 것 */
export type Strike = {
  difficulty: number;
  combo: number;
  /** 문제가 뜬 뒤 답하기까지 걸린 시간 (단검) */
  answerMs: number;
};

/**
 * 정답 → 보스 HP 감소.
 *
 * 피해 = 기본(10, 어려운 단어 20) + 콤보(상한 10) + 무기 등급(+1~+5) + 무기 특기.
 * 특기는 계열마다 하나다 (game/weaponPerk.ts).
 *
 * @param weapon 장착한 무기. 없으면 맨손
 */
export function hitBoss(
  boss: BossState,
  strike: Strike,
  weapon: Armament = { bonus: 0, family: null },
): BossHit {
  const critical = strike.difficulty >= 0.5;
  const family = weapon.family;
  let perk: WeaponFamily | null = null;

  // 검 — 콤보 상한이 오른다. 상한을 넘긴 콤보에서만 발동한다
  const comboCap = DAMAGE_COMBO_MAX + (family === 'sword' ? SWORD_COMBO_CAP_BONUS : 0);
  const comboDamage = Math.min(comboCap, Math.floor(strike.combo / 2));
  if (family === 'sword' && comboDamage > DAMAGE_COMBO_MAX) perk = 'sword';

  let damage = (critical ? DAMAGE_HARD : DAMAGE_BASE) + comboDamage + Math.max(0, weapon.bonus);

  if (family === 'axe' && critical) {
    damage += AXE_CRIT_BONUS;
    perk = 'axe';
  }
  // 망치는 피해가 아니라 연출(크게 밀린다)이다 — 크리티컬이면 발동으로 친다
  if (family === 'hammer' && critical) perk = 'hammer';
  if (family === 'dagger' && strike.answerMs <= DAGGER_FAST_MS) {
    damage += DAGGER_BONUS;
    perk = 'dagger';
  }
  if (family === 'fist' && strike.combo > 0) {
    damage += Math.min(FIST_MAX, strike.combo);
    perk = 'fist';
  }
  // 활 — 배수는 마지막에 곱한다. 추가분은 BOW_MAX_EXTRA 까지만
  if (family === 'bow' && boss.hits === 0) {
    damage += Math.min(BOW_MAX_EXTRA, damage * (BOW_FIRST_MULT - 1));
    perk = 'bow';
  }

  const hp = Math.max(0, boss.hp - damage);
  boss.hp = hp;
  boss.asked++;
  boss.hits++;
  return { damage, hp, defeated: hp === 0, critical, perk };
}

/**
 * 오답 → 보스전에서도 문제 수는 센다 (통계·연출용).
 *
 * @returns 보스가 회복한 HP (흡혈귀가 아니면 0)
 */
export function missBoss(boss: BossState): number {
  boss.asked++;
  if (!boss.regen || boss.hp >= boss.maxHp) return 0;
  const heal = Math.min(boss.maxHp - boss.hp, REGEN_MAX, Math.ceil(boss.maxHp * REGEN_RATIO));
  boss.hp += heal;
  return heal;
}

export function hpRatio(boss: BossState): number {
  return boss.hp / boss.maxHp;
}

/** 처치 보상 — 보물상자 (PRD 14장). 대보스는 두 배다 */
export function bossReward(boss: Pick<BossState, 'index' | 'giant'>): { gold: number; exp: number } {
  const k = boss.giant ? 2 : 1;
  return { gold: (40 + boss.index * 20) * k, exp: (60 + boss.index * 30) * k };
}
