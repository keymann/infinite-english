import * as THREE from 'three';

/**
 * 월드 테마 — 층에 따라 배경이 바뀐다.
 *
 * PRD 17장의 6개 월드는 **학습 레벨**에 묶이는 개념이고(Forest=초3~4 … Dragon=중3),
 * 스테이지가 여러 개 생기는 V2 에서 그 매핑이 의미를 갖는다.
 * 지금 필요한 것은 다른 것이다: **한 판 안에서 올라갈수록 배경이 달라지는 것.**
 * 그래서 층 구간(band)으로 테마를 나눈다 (Phase 5 완료 기준).
 *
 * 모델 세트는 2개(forest·castle)뿐이지만, 하늘·안개·조명·계단 색조를 함께 바꾸면
 * 4개 구간이 확실히 구분된다. "저녁이 됐다"는 같은 모델로도 전달된다.
 */

/** 모델 세트 — 어떤 bundle 의 어떤 노드를 쓰는지 */
export type WorldSet = {
  id: string;
  bundle: string;
  /** 계단 블록 */
  step: string;
  /** 배경 프롭을 받치는 떠 있는 섬 */
  island: string;
  /** 섬 위에 세우는 큰 프롭 (앞쪽이 자주 나온다) */
  props: string[];
  /** 계단 블록 위에 올리는 작은 소품. 없으면 빈 배열 */
  decor: string[];
};

export const WORLD_SETS: Record<string, WorldSet> = {
  forest: {
    id: 'forest',
    bundle: 'world-forest',
    step: 'cliff_block_rock',
    island: 'cliff_blockHalf_rock',
    props: [
      'tree_default',
      'tree_pineRoundA',
      'tree_pineTallA',
      'tree_thin',
      'tree_small',
      'rock_largeA',
      'plant_bush',
    ],
    decor: ['grass', 'grass_large', 'mushroom_red', 'flower_yellowA', 'rock_smallA'],
  },
  castle: {
    id: 'castle',
    bundle: 'world-castle',
    step: 'tower-square-base',
    island: 'wall-half',
    props: [
      'tower-square-mid',
      'tower-square-top-roof',
      'wall-pillar',
      'wall-corner',
      'gate',
      'flag-banner-long',
    ],
    // 성벽 kit 에는 계단 위에 올릴 만한 작은 소품이 없다. 억지로 넣지 않는다
    decor: [],
  },
};

export type Theme = {
  id: string;
  /** 체크포인트 배너에 쓰는 이름 */
  name: string;
  /** 이 층부터 적용 */
  fromFloor: number;
  setId: string;
  sky: number;
  fogDensity: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  sunColor: number;
  sunIntensity: number;
  /** 계단 색조. 콤보 연출 색과 **곱해진다** (stairs.ts) */
  stepTint: THREE.Color;
};

export const THEMES: Theme[] = [
  {
    id: 'forest-day',
    name: 'Word Forest',
    fromFloor: 0,
    setId: 'forest',
    sky: 0x8fd3ff,
    fogDensity: 0.028,
    hemiSky: 0xd8ecff,
    hemiGround: 0x3f5a2a,
    hemiIntensity: 2.1,
    sunColor: 0xfff2d0,
    sunIntensity: 1.5,
    stepTint: new THREE.Color(1, 1, 1),
  },
  {
    id: 'forest-evening',
    name: 'Forest Sunset',
    fromFloor: 10,
    setId: 'forest',
    sky: 0xf7a86b,
    fogDensity: 0.036,
    hemiSky: 0xffd6a5,
    hemiGround: 0x4a3a28,
    hemiIntensity: 1.7,
    sunColor: 0xffb066,
    sunIntensity: 1.6,
    stepTint: new THREE.Color(1.05, 0.86, 0.7),
  },
  {
    id: 'castle-dusk',
    name: 'Stone Castle',
    fromFloor: 20,
    setId: 'castle',
    sky: 0x6b6f9e,
    fogDensity: 0.03,
    hemiSky: 0xc7cbff,
    hemiGround: 0x2b2b3a,
    hemiIntensity: 1.8,
    sunColor: 0xdfe4ff,
    sunIntensity: 1.3,
    stepTint: new THREE.Color(0.95, 0.95, 1.08),
  },
  {
    id: 'castle-night',
    name: 'Midnight Castle',
    fromFloor: 50,
    setId: 'castle',
    sky: 0x1b2145,
    fogDensity: 0.042,
    hemiSky: 0x5f6bb0,
    hemiGround: 0x14161f,
    hemiIntensity: 1.5,
    sunColor: 0xffd9a0,
    sunIntensity: 1.1,
    stepTint: new THREE.Color(0.62, 0.68, 0.95),
  },
];

export function themeForFloor(floor: number): Theme {
  let found = THEMES[0];
  for (const theme of THEMES) {
    if (floor >= theme.fromFloor) found = theme;
  }
  return found;
}

/** 다음 테마가 시작되는 층 (없으면 null) */
export function nextThemeFloor(floor: number): number | null {
  for (const theme of THEMES) {
    if (theme.fromFloor > floor) return theme.fromFloor;
  }
  return null;
}

export const THEME_BUNDLES = [...new Set(Object.values(WORLD_SETS).map((s) => s.bundle))];
