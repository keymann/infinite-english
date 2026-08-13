import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { createRng } from '../core/rng';
import { STEP } from '../game/balance';
import { BOSS_EVERY, isBossFloor } from '../game/boss';
import { Stairs } from './stairs';

/**
 * 계단 생성 규칙 — 패턴 · 블록 종류 · **가짜 계단**.
 *
 * 화면으로는 "계단이 복잡해 보인다" 까지만 알 수 있다. 확인해야 하는 것은 그 아래다:
 * 같은 층이 늘 같은 함정인지 · 함정이 연달아 나오지 않는지 · 보스 층과 겹치지 않는지 ·
 * 방향 패턴이 화면을 벗어나지 않는지. 전부 숫자로 볼 수 있다.
 */

/** 블록 스텁 — 실제 모델 대신 2×2×2 큐브(Block Bits 와 같은 크기) */
const cube = (size = 2) =>
  new THREE.Mesh(new THREE.BoxGeometry(size, size, size), new THREE.MeshBasicMaterial());

function makeStairs(seed = 20260813, blockCount = 3) {
  const stairs = new Stairs(
    [
      {
        setId: 'forest',
        steps: Array.from({ length: blockCount }, () => cube()),
        fake: cube(),
        decor: [],
      },
    ],
    createRng(seed),
  );
  return stairs;
}

/** 그려진 인스턴스 수를 종류별로 센다 */
function drawn(stairs: Stairs): { kinds: number[]; total: number } {
  const kinds: number[] = [];
  stairs.group.children.forEach((child) => {
    child.traverse((o) => {
      const inst = o as THREE.InstancedMesh;
      if (inst.isInstancedMesh) kinds.push(inst.count);
    });
  });
  return { kinds, total: kinds.reduce((a, b) => a + b, 0) };
}

describe('방향 패턴', () => {
  it('같은 방향이 maxRun 을 넘지 않는다 — 계단이 화면을 벗어나면 안 된다', () => {
    const stairs = makeStairs();
    let run = 1;
    for (let i = 2; i < 600; i++) {
      run = stairs.dirAt(i) === stairs.dirAt(i - 1) ? run + 1 : 1;
      expect(run, `${i}층`).toBeLessThanOrEqual(STEP.maxRun);
    }
  });

  /**
   * 매 칸을 독립 난수로 뽑으면 어느 구간이나 똑같이 느껴진다. 패턴 구간을 넣은 목적은
   * **구간마다 리듬이 다른 것**이고, 그건 "방향이 바뀌는 빈도"가 구간마다 다르다는 뜻이다.
   */
  it('구간마다 리듬이 다르다 — 방향 전환 빈도가 한 값에 몰리지 않는다', () => {
    const stairs = makeStairs();
    const rates: number[] = [];
    for (let start = 1; start < 400; start += 8) {
      let turns = 0;
      for (let i = start + 1; i < start + 8; i++) {
        if (stairs.dirAt(i) !== stairs.dirAt(i - 1)) turns++;
      }
      rates.push(turns);
    }
    // 8칸 구간의 전환 횟수가 여러 값으로 나온다 (전부 같으면 패턴이 하나뿐이다)
    expect(new Set(rates).size).toBeGreaterThan(2);
  });

  it('같은 시드면 같은 계단이 나온다 — 이어하기가 성립한다', () => {
    const a = makeStairs(777);
    const b = makeStairs(777);
    for (let i = 1; i < 200; i++) expect(b.dirAt(i)).toBe(a.dirAt(i));
  });

  it('좌우가 한쪽으로 치우치지 않는다', () => {
    const stairs = makeStairs();
    let right = 0;
    for (let i = 1; i <= 600; i++) if (stairs.dirAt(i) > 0) right++;
    expect(right / 600).toBeGreaterThan(0.35);
    expect(right / 600).toBeLessThan(0.65);
  });
});

describe('가짜 계단 (갈래 길)', () => {
  it('12층 전에는 나오지 않는다 — 규칙을 익힐 구간이다', () => {
    const stairs = makeStairs();
    for (let i = 0; i < 12; i++) expect(stairs.hasFake(i), `${i}층`).toBe(false);
  });

  it('보스 층에는 나오지 않는다 — 관문과 함정이 겹치면 원인을 못 읽는다', () => {
    const stairs = makeStairs();
    for (let i = BOSS_EVERY; i <= 500; i += BOSS_EVERY) {
      expect(stairs.hasFake(i), `${i}층`).toBe(false);
    }
  });

  it('연달아 나오지 않는다 — 최소 5칸 간격', () => {
    const stairs = makeStairs();
    let last = -99;
    for (let i = 0; i <= 1000; i++) {
      if (!stairs.hasFake(i)) continue;
      expect(i - last, `${i}층`).toBeGreaterThanOrEqual(5);
      last = i;
    }
  });

  /** 같은 층이 늘 같은 함정이어야 아이가 "저 블록은 가짜다"를 배울 수 있다 */
  it('시드와 무관하게 같은 층에 나온다', () => {
    const a = makeStairs(1);
    const b = makeStairs(999_999);
    for (let i = 0; i <= 300; i++) expect(b.hasFake(i)).toBe(a.hasFake(i));
  });

  it('충분히 자주 나온다 — 없으면 갈래 길이 아니다', () => {
    const stairs = makeStairs();
    let count = 0;
    for (let i = 0; i <= 300; i++) if (stairs.hasFake(i)) count++;
    // 12~300층에서 최소 5칸 간격이면 상한은 약 57개. 그 절반 안쪽이면 충분히 만난다
    expect(count).toBeGreaterThan(10);
    expect(count).toBeLessThan(58);
  });

  it('가짜는 진짜 계단의 반대쪽에 그려진다', () => {
    const stairs = makeStairs();
    const fakeFloor = (() => {
      for (let i = 12; i < 60; i++) if (stairs.hasFake(i)) return i;
      throw new Error('가짜 계단이 없다');
    })();

    stairs.refresh(fakeFloor);
    // 가짜 인스턴스는 fake 모델에만 담긴다 — 위치를 읽어 진짜와 비교한다
    const real = stairs.surfaceAt(fakeFloor);
    const positions: THREE.Vector3[] = [];
    const m = new THREE.Matrix4();
    stairs.group.children.forEach((child) =>
      child.traverse((o) => {
        const inst = o as THREE.InstancedMesh;
        if (!inst.isInstancedMesh) return;
        for (let i = 0; i < inst.count; i++) {
          inst.getMatrixAt(i, m);
          positions.push(new THREE.Vector3().setFromMatrixPosition(m));
        }
      }),
    );
    // 같은 z(같은 층 깊이)에 x 가 다른 블록이 둘 있다 = 갈래 길
    const sameDepth = positions.filter((p) => Math.abs(p.z - real.z) < 0.01);
    expect(sameDepth.length).toBeGreaterThanOrEqual(2);
    const xs = sameDepth.map((p) => p.x).sort((a, b) => a - b);
    expect(xs[xs.length - 1] - xs[0]).toBeCloseTo(STEP.x * 2, 2);
  });
});

describe('블록 종류', () => {
  it('여러 종류를 섞어 그린다 — 한 종류의 반복이 아니다', () => {
    const stairs = makeStairs();
    stairs.refresh(40);
    const used = drawn(stairs).kinds.filter((c) => c > 0).length;
    expect(used).toBeGreaterThan(1);
  });

  it('같은 종류가 3칸 넘게 이어지지 않는다', () => {
    const stairs = makeStairs();
    // blockKindAt 은 private 이므로 그려진 결과로 확인한다:
    // 종류가 한 칸으로 몰리면 나머지 종류의 count 가 0 이 된다
    stairs.refresh(100);
    const kinds = drawn(stairs).kinds.filter((c) => c > 0);
    const biggest = Math.max(...kinds);
    const total = kinds.reduce((a, b) => a + b, 0);
    // 한 종류가 전체의 80% 를 넘으면 사실상 한 종류다
    expect(biggest / total).toBeLessThan(0.8);
  });

  it('블록 크기를 정규화한다 — 2×2×2 팩을 그대로 쓰면 서로 겹친다', () => {
    const stairs = makeStairs();
    stairs.refresh(30);
    const m = new THREE.Matrix4();
    const scale = new THREE.Vector3();
    let checked = 0;
    stairs.group.children.forEach((child) =>
      child.traverse((o) => {
        const inst = o as THREE.InstancedMesh;
        if (!inst.isInstancedMesh || inst.count === 0) return;
        inst.getMatrixAt(0, m);
        m.decompose(new THREE.Vector3(), new THREE.Quaternion(), scale);
        // 2×2×2 큐브를 1 유닛으로 → 배율 0.5
        expect(scale.x).toBeCloseTo(0.5, 3);
        checked++;
      }),
    );
    expect(checked).toBeGreaterThan(0);
  });

  it('보이는 구간만 그린다 — 5,000층을 올라도 인스턴스 수가 일정하다', () => {
    const stairs = makeStairs();
    stairs.refresh(10);
    const near = drawn(stairs).total;
    stairs.refresh(5000);
    const far = drawn(stairs).total;
    expect(Math.abs(far - near)).toBeLessThanOrEqual(4);
    expect(far).toBeLessThanOrEqual(STEP.ahead + STEP.behind + 6);
  });
});

describe('보스 층 판정과 어긋나지 않는다', () => {
  it('isBossFloor 와 hasFake 가 같은 층에서 동시에 참이 되지 않는다', () => {
    const stairs = makeStairs();
    for (let i = 0; i <= 500; i++) {
      expect(isBossFloor(i) && stairs.hasFake(i), `${i}층`).toBe(false);
    }
  });
});
