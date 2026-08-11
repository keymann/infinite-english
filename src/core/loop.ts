/**
 * 고정 타임스텝 루프.
 *
 * 렌더 프레임(60Hz·120Hz·30Hz 제각각)과 게임 로직을 분리한다. 로직이 프레임레이트에
 * 딸려 가면 기기마다 게임 속도가 달라지고, 리플레이·시뮬레이터가 성립하지 않는다.
 */

const STEP_SEC = 1 / 60;
/** 한 프레임에 몰아서 처리할 최대 스텝 수. 탭 복귀 시 수천 스텝을 돌리면 화면이 멈춘다 */
const MAX_SUBSTEPS = 5;

export type Loop = { stop(): void };

export function startLoop(update: (dt: number) => void, render: () => void): Loop {
  let raf = 0;
  let last = performance.now();
  let acc = 0;
  let stopped = false;

  const frame = (now: number) => {
    if (stopped) return;
    raf = requestAnimationFrame(frame);

    // 탭이 비활성이었다면 delta 가 수십 초가 된다 — 잘라낸다
    const delta = Math.min((now - last) / 1000, 0.25);
    last = now;
    acc += delta;

    let steps = 0;
    while (acc >= STEP_SEC && steps < MAX_SUBSTEPS) {
      update(STEP_SEC);
      acc -= STEP_SEC;
      steps++;
    }
    if (steps === MAX_SUBSTEPS) acc = 0;

    render();
  };

  raf = requestAnimationFrame(frame);

  return {
    stop() {
      stopped = true;
      cancelAnimationFrame(raf);
    },
  };
}
