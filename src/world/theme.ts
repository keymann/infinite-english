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
  snow: {
    id: 'snow',
    bundle: 'world-snow',
    // 눈 타일은 1×0.2×1 로 얇다 — 공중에 뜬 **얼음판**처럼 보여 숲·성과 확실히 구분된다
    step: 'snow-tile',
    island: 'snow-tile-rock',
    props: [
      'snow-detail-tree-large',
      'snow-detail-tree',
      'snow-detail-crystal-large',
      'snow-wood-structure',
      'snow-detail-rocks-large',
    ],
    decor: ['snow-detail-crystal', 'snow-detail-rocks', 'snow-detail-dirt'],
  },
  sky: {
    id: 'sky',
    bundle: 'world-sky',
    step: 'platform_wood_1x1x1',
    island: 'floor_wood_2x2',
    props: ['structure_C', 'structure_B', 'pillar_2x2x4', 'pillar_1x1x4', 'strut_vertical', 'sign'],
    decor: ['cone', 'ball'],
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

/**
 * 배경 명세 — 하늘·해/달·별·구름·원경 실루엣·날씨.
 *
 * 텍스처를 새로 만들지 않는다. 그라디언트 하늘은 셰이더 두 색으로, 원경은 절차적 도형으로,
 * 날씨는 파티클로 만든다. 배경 전체가 **draw call 7개 안에서** 끝난다.
 */
export type BackdropSpec = {
  /** 그라디언트 하늘 — 위/아래 색 */
  skyTop: number;
  skyBottom: number;
  /** 해 또는 달. `height` 는 지평선(0)~천정(1) */
  celestial: { color: number; size: number; height: number; drop: number } | null;
  /** 별 개수 (0 이면 없음) */
  stars: number;
  clouds: { count: number; color: number; opacity: number };
  /** 원경 실루엣 — 산 능선·성탑·빙하·떠 있는 바위 */
  distant: {
    kind: 'mountain' | 'tower' | 'glacier' | 'rock' | 'none';
    color: number;
    count: number;
    scale: number;
  };
  /** 날씨 파티클 — 낙엽·눈가루 */
  weather: { kind: 'leaf' | 'snow' | 'none'; count: number; color: number };
  /** 성벽 횃불 */
  torches: boolean;
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
  backdrop: BackdropSpec;
};

/**
 * 층 구간 — **100층 단위**.
 *
 * 한 판에 100층을 오르려면 정답이 25~100개 필요하다(콤보에 따라 한 문제에 1~4칸).
 * 그래서 첫 판은 대부분 Word Forest 에서 끝나고, 뒤 월드는 실력이 붙은 뒤에 만난다 —
 * 배경이 바뀌는 것이 **오래 남는 목표**가 되도록 한 배치다.
 * 개발 중에는 `?floor=250` 으로 그 층에서 바로 시작해 확인할 수 있다.
 */
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
    backdrop: {
      skyTop: 0x3f9fe0,
      skyBottom: 0xd6f0ff,
      celestial: { color: 0xfff8d8, size: 3.2, height: 0.78, drop: 0 },
      stars: 0,
      clouds: { count: 7, color: 0xffffff, opacity: 0.9 },
      distant: { kind: 'mountain', color: 0x3f6b58, count: 16, scale: 1 },
      weather: { kind: 'none', count: 0, color: 0xffffff },
      torches: false,
    },
  },
  {
    /* 노을빛 숲 — 하늘은 주황·분홍, 능선은 붉게 물들고 낙엽이 흩날린다.
       올라갈수록 해가 낮아진다 (celestial.drop) */
    id: 'forest-evening',
    name: 'Forest Sunset',
    fromFloor: 100,
    setId: 'forest',
    sky: 0xf7a86b,
    fogDensity: 0.034,
    hemiSky: 0xffd6a5,
    hemiGround: 0x4a3a28,
    hemiIntensity: 1.75,
    sunColor: 0xffb066,
    sunIntensity: 1.7,
    stepTint: new THREE.Color(1.08, 0.86, 0.68),
    backdrop: {
      skyTop: 0x8e4a86,
      skyBottom: 0xffa457,
      celestial: { color: 0xff7a3c, size: 7.5, height: 0.16, drop: 0.1 },
      stars: 0,
      clouds: { count: 9, color: 0xff9fa8, opacity: 0.85 },
      distant: { kind: 'mountain', color: 0x5c2f45, count: 17, scale: 1.1 },
      weather: { kind: 'leaf', count: 130, color: 0xe0913c },
      torches: false,
    },
  },
  {
    /* 고대 석조 성 — 거대한 성탑과 성문, 성벽의 횃불, 극적인 구름 */
    id: 'castle-dusk',
    name: 'Stone Castle',
    fromFloor: 200,
    setId: 'castle',
    sky: 0x6b6f9e,
    fogDensity: 0.03,
    hemiSky: 0xc7cbff,
    hemiGround: 0x2b2b3a,
    hemiIntensity: 1.85,
    sunColor: 0xdfe4ff,
    sunIntensity: 1.35,
    stepTint: new THREE.Color(0.96, 0.96, 1.08),
    backdrop: {
      skyTop: 0x3b4570,
      skyBottom: 0xb9c2e8,
      celestial: { color: 0xffeecb, size: 4, height: 0.46, drop: 0.04 },
      stars: 0,
      clouds: { count: 11, color: 0xdfe4f5, opacity: 0.92 },
      distant: { kind: 'tower', color: 0x2c3150, count: 14, scale: 1.2 },
      weather: { kind: 'none', count: 0, color: 0xffffff },
      torches: true,
    },
  },
  {
    /* 얼어붙은 설산 — 빙하와 봉우리, 눈가루가 강풍에 흩날린다.
       정상에 가까워질수록 하늘이 짙은 파란색이 된다 */
    id: 'snow-peak',
    name: 'Frozen Peak',
    fromFloor: 300,
    setId: 'snow',
    sky: 0xcfe9ff,
    fogDensity: 0.036,
    hemiSky: 0xeaf6ff,
    hemiGround: 0x8aa6bf,
    hemiIntensity: 2.35,
    sunColor: 0xffffff,
    sunIntensity: 1.45,
    stepTint: new THREE.Color(1, 1, 1.06),
    backdrop: {
      skyTop: 0x0d3f80,
      skyBottom: 0xd8ecff,
      celestial: { color: 0xf2fbff, size: 3.4, height: 0.34, drop: 0 },
      stars: 0,
      clouds: { count: 6, color: 0xffffff, opacity: 0.75 },
      distant: { kind: 'glacier', color: 0x9ccbeb, count: 17, scale: 1.2 },
      weather: { kind: 'snow', count: 220, color: 0xffffff },
      torches: false,
    },
  },
  {
    /* 하늘섬 — 구름 위에 떠 있는 섬과 바위, 아래로 떨어지는 폭포 */
    id: 'sky-islands',
    name: 'Sky Islands',
    fromFloor: 400,
    setId: 'sky',
    sky: 0x63c8ff,
    fogDensity: 0.022,
    hemiSky: 0xdff3ff,
    hemiGround: 0x5c86a8,
    hemiIntensity: 2.25,
    sunColor: 0xfff6de,
    sunIntensity: 1.6,
    stepTint: new THREE.Color(1, 1, 1),
    backdrop: {
      skyTop: 0x1f86dc,
      skyBottom: 0xc9edff,
      celestial: { color: 0xfff0b0, size: 4.6, height: 0.6, drop: 0 },
      stars: 0,
      clouds: { count: 15, color: 0xffffff, opacity: 0.95 },
      distant: { kind: 'rock', color: 0x7c8ea6, count: 14, scale: 1.15 },
      weather: { kind: 'none', count: 0, color: 0xffffff },
      torches: false,
    },
  },
  {
    /* 한밤중의 마법 성 — 거대한 달과 별, 짙은 안개, 탑의 푸른 불빛 */
    id: 'castle-night',
    name: 'Midnight Castle',
    fromFloor: 500,
    setId: 'castle',
    sky: 0x1b2145,
    fogDensity: 0.046,
    hemiSky: 0x5f6bb0,
    hemiGround: 0x14161f,
    hemiIntensity: 1.5,
    sunColor: 0xffd9a0,
    sunIntensity: 1.1,
    stepTint: new THREE.Color(0.6, 0.66, 0.95),
    backdrop: {
      skyTop: 0x04050d,
      skyBottom: 0x232a55,
      celestial: { color: 0xe9f0ff, size: 8, height: 0.64, drop: 0 },
      stars: 260,
      clouds: { count: 7, color: 0x2b3154, opacity: 0.65 },
      distant: { kind: 'tower', color: 0x090c1a, count: 16, scale: 1.3 },
      weather: { kind: 'none', count: 0, color: 0xffffff },
      torches: true,
    },
  },
];

/** 이 층이 속한 구간에서 얼마나 올라왔는지 0~1 — 석양이 낮아지는 연출에 쓴다 */
export function bandProgress(floor: number): number {
  const theme = themeForFloor(floor);
  const next = nextThemeFloor(floor);
  const span = (next ?? theme.fromFloor + 100) - theme.fromFloor;
  return Math.max(0, Math.min(1, (floor - theme.fromFloor) / span));
}

/** 이 테마에 떠다니는 UFO 를 띄우는지 — 눈·하늘 월드만 */
export function hasAmbientFlyers(theme: Theme): boolean {
  return theme.setId === 'snow' || theme.setId === 'sky';
}

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
