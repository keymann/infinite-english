/**
 * 입력 통합 계층.
 *
 * 키보드 · 화면 좌/우 절반 탭 · 좌/우 스와이프를 **하나의 방향 이벤트**로 정규화한다.
 * 게임 로직은 입력 장치를 모른다 — 나중에 조작을 바꿔도 로직은 그대로다.
 *
 * `방향 자동 보정`(접근성): 켜면 어느 쪽을 눌러도 올라간다. 소근육 발달 차이나
 * 저학년을 조작 난이도로 걸러내지 않기 위한 옵션이다 (기획서 3.2절).
 */

export type Dir = -1 | 1;

export type InputOptions = {
  /** 방향 자동 보정 — 입력이 들어오면 항상 "맞는 방향"으로 해석한다 */
  autoDir: boolean;
};

/** 스와이프로 인정하는 최소 이동 픽셀. 이보다 짧으면 탭으로 본다 */
const SWIPE_PX = 28;

export class Input {
  readonly options: InputOptions;
  /** autoDir 일 때 게임이 정답 방향을 알려주는 함수 */
  resolveAuto: (() => Dir) | null = null;

  private queue: Dir[] = [];
  private downX = 0;
  private downId = -1;
  private readonly el: HTMLElement;
  private readonly disposers: Array<() => void> = [];

  constructor(el: HTMLElement, options: InputOptions) {
    this.el = el;
    this.options = options;

    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') this.push(-1);
      else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') this.push(1);
      else return;
      e.preventDefault();
    };

    const onDown = (e: PointerEvent) => {
      if (this.downId !== -1) return;
      this.downId = e.pointerId;
      this.downX = e.clientX;
    };

    const onUp = (e: PointerEvent) => {
      if (e.pointerId !== this.downId) return;
      this.downId = -1;
      const dx = e.clientX - this.downX;
      if (Math.abs(dx) >= SWIPE_PX) {
        this.push(dx < 0 ? -1 : 1);
        return;
      }
      // 탭 — 화면을 좌우로 반 갈라 판정한다. 버튼을 그리지 않는 이유는
      // 계단 게임에서 손가락이 화면 아래 어디에 있어도 즉시 반응해야 하기 때문이다.
      const rect = this.el.getBoundingClientRect();
      this.push(e.clientX - rect.left < rect.width / 2 ? -1 : 1);
    };

    const onCancel = (e: PointerEvent) => {
      if (e.pointerId === this.downId) this.downId = -1;
    };

    window.addEventListener('keydown', onKey);
    this.el.addEventListener('pointerdown', onDown);
    this.el.addEventListener('pointerup', onUp);
    this.el.addEventListener('pointercancel', onCancel);

    this.disposers.push(
      () => window.removeEventListener('keydown', onKey),
      () => this.el.removeEventListener('pointerdown', onDown),
      () => this.el.removeEventListener('pointerup', onUp),
      () => this.el.removeEventListener('pointercancel', onCancel),
    );
  }

  private push(dir: Dir) {
    // 큐가 길어지면 놓친 입력이 나중에 쏟아진다 — 2개까지만 기억한다
    if (this.queue.length < 2) this.queue.push(dir);
  }

  /** 대기 중인 입력을 하나 꺼낸다. 없으면 null */
  take(): Dir | null {
    const dir = this.queue.shift();
    if (dir === undefined) return null;
    if (this.options.autoDir && this.resolveAuto) return this.resolveAuto();
    return dir;
  }

  clear() {
    this.queue.length = 0;
  }

  dispose() {
    for (const d of this.disposers) d();
    this.disposers.length = 0;
  }
}
