import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { createRng } from '../core/rng';
import { Stairs } from '../world/stairs';
import type { Actor } from '../three/actor';
import { CLIMB, STAIR_TIMER, stairTimeFor } from './balance';
import { Climb } from './climb';

/**
 * 계단 조작 규칙 — **방향을 틀리면 판이 끝난다** + 계단 타이머.
 *
 * 이 두 규칙은 눈으로 확인하기 어렵다. "틀린 방향을 눌렀는데 안 죽는다"나
 * "높은 층에서 타이머가 2초 아래로 내려간다"는 화면을 봐서는 놓친다.
 * 그래서 상태머신과 시간 공식을 여기서 직접 검사한다.
 *
 * `Stairs` 는 모델 없이(`sets = []`) 만들어도 `dirAt`·`surfaceAt` 가 순수 계산이라
 * 헤드리스에서 그대로 쓸 수 있다. Actor 만 최소 스텁으로 대체한다.
 */

function stubActor(): Actor {
  return {
    root: new THREE.Object3D(),
    height: 0.92,
    play() {},
    update() {},
    has: () => false,
  } as unknown as Actor;
}

function makeClimb() {
  const stairs = new Stairs([], createRng(20260812));
  const events = { wrongDir: 0, lands: [] as number[] };
  const climb = new Climb(stairs, stubActor(), {
    onLand: (floor) => events.lands.push(floor),
    onWrongDir: () => events.wrongDir++,
  });
  /** 점프가 끝날 때까지 시간을 흘린다 */
  const settle = () => {
    for (let i = 0; i < 20 && climb.state === 'jump'; i++) climb.update(CLIMB.jumpSec / 4);
  };
  return { climb, stairs, events, settle };
}

describe('방향 오선택 — 판이 끝난다', () => {
  it('맞는 방향이면 한 칸 오른다', () => {
    const { climb, settle, events } = makeClimb();
    climb.input(climb.nextDir);
    settle();
    expect(climb.floor).toBe(1);
    expect(climb.state).toBe('stand');
    expect(events.wrongDir).toBe(0);
  });

  it('틀린 방향이면 층이 오르지 않고 onWrongDir 이 즉시 불린다', () => {
    const { climb, events } = makeClimb();
    const wrong = (climb.nextDir * -1) as 1 | -1;
    climb.input(wrong);
    expect(events.wrongDir).toBe(1);
    expect(climb.floor).toBe(0);
    expect(climb.state).toBe('stumble');
  });

  it('연출이 끝나면 dead 로 굳는다 — stand 로 돌아오지 않는다', () => {
    const { climb } = makeClimb();
    climb.input((climb.nextDir * -1) as 1 | -1);
    climb.update(CLIMB.stumbleSec + 0.01);
    expect(climb.state).toBe('dead');
    // 시간을 더 흘려도 되살아나지 않는다
    climb.update(5);
    expect(climb.state).toBe('dead');
  });

  it('죽은 뒤의 입력은 무시된다 — 계단을 계속 오를 수 없다', () => {
    const { climb, settle } = makeClimb();
    climb.input((climb.nextDir * -1) as 1 | -1);
    climb.update(CLIMB.stumbleSec + 0.01);
    climb.input(climb.nextDir);
    settle();
    expect(climb.floor).toBe(0);
    expect(climb.state).toBe('dead');
  });

  /*
   * 이전 규칙("같은 칸에서 3번 틀리면 그냥 올려 보낸다")이 남아 있으면
   * 세 번째 오선택에서 층이 올라간다. 그 자동 통과가 사라졌음을 고정한다.
   */
  it('3회 실수 자동 통과가 남아 있지 않다', () => {
    const { climb } = makeClimb();
    const wrong = (climb.nextDir * -1) as 1 | -1;
    for (let i = 0; i < 3; i++) {
      climb.input(wrong);
      climb.update(CLIMB.stumbleSec + 0.01);
    }
    expect(climb.floor).toBe(0);
    // 첫 오선택에서 이미 끝났으므로 이벤트는 한 번만 난다
    expect(climb.totalMisses).toBe(1);
  });

  it('reset 하면 다시 오를 수 있다', () => {
    const { climb, stairs, settle } = makeClimb();
    climb.input((climb.nextDir * -1) as 1 | -1);
    climb.update(CLIMB.stumbleSec + 0.01);
    climb.reset();
    expect(climb.state).toBe('stand');
    expect(climb.totalMisses).toBe(0);
    void stairs;
    climb.input(climb.nextDir);
    settle();
    expect(climb.floor).toBe(1);
  });
});

describe('계단 타이머 — 층이 높을수록 짧아지고 하한은 2초', () => {
  it('0층은 시작값', () => {
    expect(stairTimeFor(0)).toBe(STAIR_TIMER.startSec);
  });

  it('층이 오르면 단조 감소한다', () => {
    for (let floor = 0; floor < 400; floor += 20) {
      expect(stairTimeFor(floor + 20)).toBeLessThanOrEqual(stairTimeFor(floor));
    }
  });

  it('어떤 층에서도 2초 아래로 내려가지 않는다', () => {
    for (const floor of [0, 100, 300, 500, 1000, 9999, 1e6]) {
      expect(stairTimeFor(floor)).toBeGreaterThanOrEqual(STAIR_TIMER.minSec);
    }
  });

  it('하한에 닿은 뒤에는 계속 2초다', () => {
    const floorAtMin = (STAIR_TIMER.startSec - STAIR_TIMER.minSec) / STAIR_TIMER.decayPerFloor;
    expect(stairTimeFor(floorAtMin)).toBeCloseTo(STAIR_TIMER.minSec, 6);
    expect(stairTimeFor(floorAtMin + 500)).toBe(STAIR_TIMER.minSec);
  });

  /* 음수 층은 들어올 수 없지만, 들어와도 시작값보다 길어지면 안 된다 */
  it('음수 층에서도 시작값을 넘지 않는다', () => {
    expect(stairTimeFor(-50)).toBe(STAIR_TIMER.startSec);
  });
});
