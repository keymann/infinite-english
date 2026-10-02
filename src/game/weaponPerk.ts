/**
 * 무기 특기 — 계열마다 보스전 규칙 하나를 바꾼다.
 *
 * 가격 등급의 추가 피해(+1~+5, progress/shop.ts)만으로는 무기 22종이 "숫자 큰 칼" 하나로
 * 읽혔다. 계열마다 **어떻게 맞혀야 유리한지**가 달라지면 아이가 무기를 고르는 이유가 생긴다.
 *
 * | 계열 | 특기 | 아이에게 주는 신호 |
 * |---|---|---|
 * | 검 | 콤보 피해 상한 +5 | 끊지 말고 이어 맞혀라 |
 * | 도끼 | 어려운 단어 크리티컬 +5 | 어려운 단어가 기회다 |
 * | 망치 | 크리티컬이면 보스가 크게 밀린다 | (연출) 한 방이 무겁다 |
 * | 단검 | 3초 안에 맞히면 +4 | 빨리 떠올려라 |
 * | 활 | 보스전 첫 정답 2배 (최대 +10) | 첫 문제에 집중하라 |
 * | 창(할버드) | 보스 등장 즉시 선제 피해 10 | — |
 * | 지팡이(마법봉) | 흡혈귀 회복을 막는다 | 상성이 있다 |
 * | 너클 | 연속 정답마다 +1 (최대 +5) | 연속으로 맞혀라 |
 *
 * **어떤 특기도 정답을 대신 고르지 않는다.** 전부 "맞혔을 때 얼마나 아픈가" 만 바꾼다.
 * 기본 피해 10 에 비해 특기는 +4~+10 이라, 보스전이 1~3문제 짧아지는 정도다.
 *
 * three·DOM 을 import 하지 않는다 — Session(규칙)과 테스트가 그대로 쓴다.
 */

export type WeaponFamily = 'sword' | 'axe' | 'hammer' | 'dagger' | 'bow' | 'spear' | 'staff' | 'fist';

/** 타격 연출의 종류 — world/hitFx.ts 가 그린다 */
export type FxKind = 'slash' | 'fire' | 'quake' | 'spark' | 'arrow' | 'thrust' | 'magic' | 'star';

export type Perk = {
  family: WeaponFamily;
  /** 상점·로비에 붙는 특기 이름 */
  name: string;
  /** 한 줄 설명 */
  hint: string;
  fx: FxKind;
  /** 연출 색 (0xRRGGBB) */
  color: number;
};

export const PERKS: Record<WeaponFamily, Perk> = {
  sword: { family: 'sword', name: '연속 베기', hint: '콤보 피해 상한 +5', fx: 'slash', color: 0xe8f4ff },
  axe: { family: 'axe', name: '쪼개기', hint: '어려운 단어를 맞히면 +5', fx: 'fire', color: 0xff8a3d },
  hammer: { family: 'hammer', name: '땅울림', hint: '어려운 단어를 맞히면 보스가 크게 밀린다', fx: 'quake', color: 0xffd24a },
  dagger: { family: 'dagger', name: '번개 찌르기', hint: '3초 안에 맞히면 +4', fx: 'spark', color: 0x5ce1ff },
  bow: { family: 'bow', name: '첫 화살', hint: '보스전 첫 정답 피해 2배 (최대 +10)', fx: 'arrow', color: 0xb6ff6a },
  spear: { family: 'spear', name: '선제 찌르기', hint: '보스가 나오자마자 피해 10', fx: 'thrust', color: 0xfff1a8 },
  staff: { family: 'staff', name: '봉인', hint: '흡혈귀가 체력을 회복하지 못한다', fx: 'magic', color: 0xc58bff },
  fist: { family: 'fist', name: '연타', hint: '연속 정답마다 +1 (최대 +5)', fx: 'star', color: 0xffe66b },
};

/** 무기 모델 이름(asset) → 계열. 할버드는 창, 마법봉은 지팡이로 묶는다 */
export function familyOf(asset: string | null | undefined): WeaponFamily | null {
  if (!asset) return null;
  if (asset.startsWith('sword')) return 'sword';
  if (asset.startsWith('axe')) return 'axe';
  if (asset.startsWith('hammer')) return 'hammer';
  if (asset.startsWith('dagger')) return 'dagger';
  if (asset.startsWith('bow')) return 'bow';
  if (asset.startsWith('spear') || asset === 'halberd') return 'spear';
  if (asset.startsWith('staff') || asset.startsWith('wand')) return 'staff';
  if (asset.startsWith('fistweapon')) return 'fist';
  return null;
}

/** 검 — 콤보 피해 상한이 이만큼 오른다 */
export const SWORD_COMBO_CAP_BONUS = 5;
/** 도끼 — 어려운 단어 크리티컬 추가 피해 */
export const AXE_CRIT_BONUS = 5;
/** 단검 — 빠른 정답 기준(ms)과 추가 피해. 기준은 SPEED 능력치와 같다 (progress/player.ts) */
export const DAGGER_FAST_MS = 3000;
export const DAGGER_BONUS = 4;
/**
 * 활 — 보스전 첫 정답 배수와 추가분 상한.
 *
 * 콤보는 보스 사이에 이어지므로, 상한이 없으면 어려운 단어 + 높은 콤보의 첫 정답이
 * 활 하나로 +30 을 넘는다. 다른 특기(+4~+10)와 맞춘다.
 */
export const BOW_FIRST_MULT = 2;
export const BOW_MAX_EXTRA = 10;
/** 창 — 보스 등장 즉시 주는 피해 */
export const SPEAR_OPENER = 10;
/** 너클 — 연속 정답 하나당 +1, 상한 */
export const FIST_MAX = 5;

/** 장착한 무기 — Session 이 받는다 (Session 은 상점을 모르고 숫자·계열만 안다) */
export type Armament = {
  /** 가격 등급 추가 피해 (+1~+5) */
  bonus: number;
  family: WeaponFamily | null;
};

export const BARE_HANDS: Armament = { bonus: 0, family: null };
