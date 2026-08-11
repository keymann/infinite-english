/**
 * 시드 난수 (mulberry32).
 *
 * Math.random 을 쓰지 않는 이유: 계단 방향이 재현 가능해야 한다.
 *  - 이어하기: 저장한 시드로 같은 계단을 다시 만든다
 *  - 시뮬레이터/버그 재현: 같은 시드면 같은 판이 나온다
 */
export type Rng = () => number;

export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomSeed(): number {
  return (Math.random() * 0xffffffff) >>> 0;
}
