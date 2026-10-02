import { BOSS_EVERY } from './boss';

/**
 * 보스 로스터 — **몇 층에 어떤 보스가 나오는지**.
 *
 * 해골 3종을 번갈아 내던 시절에는 세 번째 보스부터 배경이 됐다. 생김새·동작이 같으면
 * 아이는 보스를 "또 그거"로 읽는다. 그래서 세 축으로 다양화한다.
 *
 * | 축 | 하는 일 |
 * |---|---|
 * | 종 | 테마 구간마다 다른 몬스터 무리 (해골 4종 + Kenney 몬스터 6종) |
 * | 무기 | 같은 몸에 다른 무기를 들린다 (`gear`) |
 * | 등급 | **50층마다 대보스** — 크고, 두껍고, 보상이 두 배다 |
 *
 * 선택은 **층 번호로만** 결정한다(난수 없음). 같은 층에서는 늘 같은 보스가 나와야
 * 이어하기·재도전에서 "저 흡혈귀는 틀리면 회복한다"를 배울 수 있다.
 *
 * three·DOM 을 import 하지 않는다 — Session(규칙)과 main(연출)이 같은 답을 받는다.
 */

/** 어느 리그인지 — 클립 이름과 무기 부착 지점이 다르다 (world/bossActor.ts) */
export type BossRig = 'rigMedium' | 'kenney';

/**
 * 보스 특성. 규칙을 **하나만** 바꾼다.
 *
 * `regen`: 오답이면 보스 HP 가 조금 찬다. **플레이어 HP 는 건드리지 않는다** —
 * HP 는 영어 오답 전용이라는 규칙(기획서 3.2절)은 그대로다. 틀리면 보스전이 조금 길어질 뿐이다.
 */
export type BossTrait = 'none' | 'regen';

export type BossKind = {
  id: string;
  /** 보스 바에 띄우는 이름 */
  name: string;
  bundle: string;
  node: string;
  rig: BossRig;
  /** 특성 — 보스 바에 한 줄로 알려 준다 */
  trait: BossTrait;
  /** 손에 드는 무기 (`boss-gear` 의 노드 이름). 없으면 맨손 */
  gear?: { right?: string; left?: string };
};

export const BOSS_KINDS = {
  skeletonWarrior: { id: 'skeletonWarrior', name: '뼈 기사', bundle: 'boss-warrior', node: 'Skeleton_Warrior', rig: 'rigMedium', trait: 'none', gear: { right: 'Skeleton_Blade', left: 'Skeleton_Shield_Small_A' } },
  skeletonMage: { id: 'skeletonMage', name: '뼈 마법사', bundle: 'boss-mage', node: 'Skeleton_Mage', rig: 'rigMedium', trait: 'none', gear: { right: 'Skeleton_Staff' } },
  skeletonRogue: { id: 'skeletonRogue', name: '뼈 도적', bundle: 'boss-rogue', node: 'Skeleton_Rogue', rig: 'rigMedium', trait: 'none', gear: { right: 'Skeleton_Crossbow' } },
  skeletonMinion: { id: 'skeletonMinion', name: '뼈 졸개', bundle: 'boss-minion', node: 'Skeleton_Minion', rig: 'rigMedium', trait: 'none', gear: { right: 'Skeleton_Axe' } },
  orc: { id: 'orc', name: '오크', bundle: 'monster-orc', node: 'character-orc', rig: 'kenney', trait: 'none', gear: { right: 'weapon-spear' } },
  zombie: { id: 'zombie', name: '좀비', bundle: 'monster-zombie', node: 'character-zombie', rig: 'kenney', trait: 'none' },
  ghost: { id: 'ghost', name: '유령', bundle: 'monster-ghost', node: 'character-ghost', rig: 'kenney', trait: 'none' },
  vampire: { id: 'vampire', name: '흡혈귀', bundle: 'monster-vampire', node: 'character-vampire', rig: 'kenney', trait: 'regen' },
  skeleton: { id: 'skeleton', name: '해골 병사', bundle: 'monster-skeleton', node: 'character-skeleton', rig: 'kenney', trait: 'none', gear: { right: 'weapon-sword' } },
  keeper: { id: 'keeper', name: '묘지기', bundle: 'monster-keeper', node: 'character-keeper', rig: 'kenney', trait: 'none' },
} as const satisfies Record<string, BossKind>;

export type BossKindId = keyof typeof BOSS_KINDS;

/**
 * 테마 구간(100층)마다의 무리. 월드 테마(world/theme.ts)와 같은 경계를 쓴다.
 *
 * `crew` 는 일반 보스가 차례로 돌고, `champion` 은 그 구간의 대보스다.
 * 숲에서 시작하는 아이가 처음 만나는 보스는 **덜 무서운 쪽**(오크·좀비)이다.
 */
const BANDS: ReadonlyArray<{ fromFloor: number; crew: readonly BossKindId[]; champion: BossKindId }> = [
  { fromFloor: 0, crew: ['orc', 'zombie', 'skeletonMinion'], champion: 'orc' },
  { fromFloor: 100, crew: ['zombie', 'skeleton', 'skeletonRogue'], champion: 'skeletonWarrior' },
  { fromFloor: 200, crew: ['skeletonWarrior', 'skeletonRogue', 'keeper'], champion: 'skeletonWarrior' },
  { fromFloor: 300, crew: ['ghost', 'skeletonMage', 'skeleton'], champion: 'skeletonMage' },
  { fromFloor: 400, crew: ['vampire', 'ghost', 'orc'], champion: 'vampire' },
  { fromFloor: 500, crew: ['vampire', 'keeper', 'skeletonWarrior', 'skeletonMage'], champion: 'vampire' },
];

/** 몇 층마다 대보스가 나오는지 */
export const GIANT_EVERY = 50;

export type BossPick = {
  kind: BossKind;
  /** 대보스인지 — 크기·HP·보상이 달라진다 (game/boss.ts) */
  giant: boolean;
};

/** 대보스 층인지 */
export function isGiantFloor(floor: number): boolean {
  return floor > 0 && floor % GIANT_EVERY === 0;
}

function bandOf(floor: number) {
  let found = BANDS[0];
  for (const band of BANDS) if (floor >= band.fromFloor) found = band;
  return found;
}

/**
 * 이 층의 보스.
 *
 * 일반 보스는 구간 안의 순번으로 무리를 돈다. 그래서 같은 종이 연달아 나오지 않는다.
 * 대보스 층은 그 구간의 챔피언이 나온다.
 */
export function bossFor(floor: number): BossPick {
  const milestone = Math.max(BOSS_EVERY, Math.floor(floor / BOSS_EVERY) * BOSS_EVERY);
  const band = bandOf(milestone);
  if (isGiantFloor(milestone)) return { kind: BOSS_KINDS[band.champion], giant: true };
  const order = Math.floor((milestone - band.fromFloor) / BOSS_EVERY);
  return { kind: BOSS_KINDS[band.crew[order % band.crew.length]], giant: false };
}

/** 로스터에 나오는 모든 보스 번들 — 미리 받아 둘 목록 */
export function bossBundles(): string[] {
  return [...new Set(Object.values(BOSS_KINDS).map((k: BossKind) => k.bundle))];
}

/** 보스 바에 붙일 특성 안내 (없으면 빈 문자열) */
export function traitHint(trait: BossTrait): string {
  return trait === 'regen' ? '틀리면 체력이 찬다' : '';
}
