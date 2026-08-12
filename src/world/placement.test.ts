import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { createRng } from '../core/rng';
import { STEP } from '../game/balance';
import { Props } from './props';
import { Stairs } from './stairs';
import { WORLD_SETS } from './theme';

/**
 * 배치 검증 — **화면을 보지 않고** 확인할 수 있는 것들.
 *
 * 프롭 종류를 크게 늘리고 원경 레이어를 더했다. 여기서 두 가지가 위험하다:
 *  1. **draw call 예산**(60) — 종류가 늘면 재질이 늘고, 재질이 늘면 call 이 는다
 *  2. **좌표** — 계단은 올라가면서 안쪽으로 뻗는다. 이 축을 무시한 오프셋은
 *     오브젝트를 계단 아래에 박아 넣는다 (보스가 실제로 그랬다)
 *
 * 둘 다 숫자로 확인할 수 있으므로 스크린샷을 기다릴 이유가 없다.
 */

/** 모델 스텁 — 프롭 하나당 메시 하나(= draw call 하나) */
function stubModel(): THREE.Object3D {
  return new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
}

/** 실제 forest 세트와 같은 종류 수로 만든다 */
function makeProps(density = 1) {
  const stairs = new Stairs([], createRng(20260812));
  const set = WORLD_SETS.forest;
  const props = new Props(
    [
      {
        setId: 'forest',
        props: set.props.map(() => stubModel()),
        island: stubModel(),
      },
    ],
    density,
  );
  return { props, stairs, kindCount: set.props.length };
}

/** 지금 그려지는 InstancedMesh 수 = draw call 수 (count 0 이면 three 가 그리지 않는다) */
function drawCalls(group: THREE.Object3D): number {
  let calls = 0;
  group.traverse((o) => {
    const inst = o as THREE.InstancedMesh;
    if (inst.isInstancedMesh && inst.count > 0) calls++;
  });
  return calls;
}

type Placed = { pos: THREE.Vector3; scale: number };

/** 배치된 인스턴스의 좌표와 크기를 읽어 온다 */
function instances(group: THREE.Object3D): Placed[] {
  const out: Placed[] = [];
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const sc = new THREE.Vector3();
  group.traverse((o) => {
    const inst = o as THREE.InstancedMesh;
    if (!inst.isInstancedMesh) return;
    for (let i = 0; i < inst.count; i++) {
      inst.getMatrixAt(i, m);
      m.decompose(p, q, sc);
      out.push({ pos: p.clone(), scale: sc.x });
    }
  });
  return out;
}

/**
 * 원경인지 판별한다 — **좌표가 아니라 크기로 가른다.**
 *
 * 처음에 `|x| > 6.6`(근경 상한)으로 갈랐다가 틀렸다. 프롭 x 는 `계단 x + 이격거리` 이고
 * 계단 x 는 지그재그로 표류하므로, 근경도 6.68 까지 나온다. 크기는 겹치지 않는다 —
 * 근경 프롭 0.85~1.35 / 원경 1.7~2.9.
 */
const isFar = (p: Placed) => p.scale >= 1.5;

/** z 로 층을 되찾는다 (배치 시 z 지터가 있어 반올림한다) */
const floorOf = (p: Placed) => Math.round(-p.pos.z / STEP.z);

describe('프롭 배치 — draw call 예산', () => {
  /**
   * 종류가 20개여도 한 화면에 그려지는 종류는 그보다 훨씬 적다.
   * `InstancedMesh.count === 0` 이면 three 가 draw call 을 내지 않으므로,
   * **종류를 늘리는 것은 사실상 무료다.** 이 테스트가 그 전제를 고정한다.
   */
  it('종류를 20개 넘게 둬도 draw call 은 예산 안이다', () => {
    const { props, stairs, kindCount } = makeProps();
    expect(kindCount).toBeGreaterThanOrEqual(20); // 실제로 늘렸는지

    for (const floor of [0, 7, 33, 120, 500]) {
      props.refresh(floor, stairs);
      // 프롭 종류 + 섬 = 전체 예산 60 중 프롭이 쓰는 몫. 25 를 넘으면 재검토해야 한다
      expect(drawCalls(props.group), `${floor}층`).toBeLessThanOrEqual(25);
    }
  });

  it('저사양 프로파일(밀도 절반)에서 더 적게 그린다', () => {
    const high = makeProps(1);
    const low = makeProps(0.5);
    high.props.refresh(30, high.stairs);
    low.props.refresh(30, low.stairs);
    expect(drawCalls(low.props.group)).toBeLessThanOrEqual(drawCalls(high.props.group));
  });

  it('같은 층을 다시 그리면 같은 배치가 나온다 — 프롭이 순간이동하면 즉시 눈에 띈다', () => {
    const { props, stairs } = makeProps();
    props.refresh(30, stairs);
    const first = instances(props.group).map((p) => p.pos.toArray().join(','));
    props.refresh(60, stairs);
    props.refresh(30, stairs);
    const again = instances(props.group).map((p) => p.pos.toArray().join(','));
    expect(again).toEqual(first);
  });
});

describe('원경 레이어', () => {
  it('충분히 많이 놓인다', () => {
    const { props, stairs } = makeProps();
    props.refresh(30, stairs);
    const far = instances(props.group).filter(isFar);
    /* 처음에 원경 블록을 근경 루프 안에 뒀더니 `i % 3` 을 이미 통과한 층만 검사해
       3과 7의 공배수(21칸)마다만 놓였다 — 한 화면에 1~2개. 이 하한이 그 회귀를 잡는다 */
    expect(far.length).toBeGreaterThanOrEqual(6);
  });

  it('근경보다 멀다', () => {
    const { props, stairs } = makeProps();
    props.refresh(30, stairs);
    const all = instances(props.group);
    const far = all.filter(isFar);
    const near = all.filter((p) => !isFar(p));
    const dist = (p: Placed) => Math.abs(p.pos.x - stairs.surfaceAt(floorOf(p)).x);
    // 가장 가까운 원경이 가장 먼 근경보다 멀다 (지터 여유 1.5)
    expect(Math.min(...far.map(dist))).toBeGreaterThan(Math.max(...near.map(dist)) - 1.5);
  });

  /**
   * 원경은 **자기 층의 계단보다 아래**에 있어야 한다.
   *
   * 처음에 "현재 층 표면보다 낮다"로 단정했다가 틀렸다 — 계단이 올라가므로 앞쪽(z 가 먼)
   * 원경은 현재 층보다 높은 것이 정상이다. 기준은 현재 층이 아니라 그 오브젝트가 놓인 층이다.
   */
  it('자기 층의 계단보다 아래에 있다 — 시야를 막지 않는다', () => {
    const { props, stairs } = makeProps();
    props.refresh(30, stairs);
    for (const p of instances(props.group).filter(isFar)) {
      expect(p.pos.y).toBeLessThan(stairs.surfaceAt(floorOf(p)).y - 2);
    }
  });

  it('어떤 프롭도 계단 경로 위에 놓이지 않는다', () => {
    const { props, stairs } = makeProps();
    props.refresh(30, stairs);
    for (const p of instances(props.group)) {
      // 자기 층 계단 중심에서 최소 이격(3.4) — z 지터로 층이 ±1 밀릴 여유를 둔다
      expect(Math.abs(p.pos.x - stairs.surfaceAt(floorOf(p)).x)).toBeGreaterThan(2.0);
    }
  });
});

describe('보스 좌표 — 계단 표면 위', () => {
  /**
   * 이전 구현은 플레이어 위치에 `(0, +0.1, −2.2)` 를 더했다. 계단은 한 칸당
   * `y +0.46 · z −0.78` 로 올라가며 안쪽으로 뻗으므로, z 만 밀면 그 깊이의 계단보다
   * **아래**가 된다. 이 테스트는 옛 방식이 틀렸다는 것과 새 방식이 맞다는 것을 함께 고정한다.
   */
  it('옛 오프셋 방식은 계단 표면보다 낮다 (버그 재현)', () => {
    const stairs = new Stairs([], createRng(7));
    const playerFloor = 12;
    const player = stairs.surfaceAt(playerFloor);

    const old = player.clone().add(new THREE.Vector3(0, 0.1, -2.2));
    // 그 z 에 해당하는 계단 번호 — z 는 −0.78/칸 이다
    const floorAtThatDepth = Math.round(-old.z / STEP.z);
    const surfaceThere = stairs.surfaceAt(floorAtThatDepth).y;

    expect(old.y).toBeLessThan(surfaceThere - 0.5); // 1유닛 이상 파묻힌다
  });

  it('새 방식은 계단 표면에 정확히 선다', () => {
    const stairs = new Stairs([], createRng(7));
    const playerFloor = 12;
    const ahead = 3;
    const pos = stairs.surfaceAt(playerFloor + ahead);

    // y·z 가 그 칸의 계단 표면과 일치한다
    const expected = stairs.surfaceAt(playerFloor + ahead);
    expect(pos.y).toBeCloseTo(expected.y, 6);
    expect(pos.z).toBeCloseTo(expected.z, 6);
    // 플레이어보다 위에 있다 — 길을 막고 있어야 관문으로 읽힌다
    expect(pos.y).toBeGreaterThan(stairs.surfaceAt(playerFloor).y);
    expect(pos.y - stairs.surfaceAt(playerFloor).y).toBeCloseTo(ahead * STEP.y, 6);
  });
});
