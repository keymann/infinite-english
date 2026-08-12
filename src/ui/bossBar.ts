/**
 * 보스 HP 바 · 이벤트 타이머.
 *
 * 둘 다 화면 상단에 둔다. 퀴즈 패널(아래)과 계단(가운데)을 가리지 않는 유일한 자리다.
 * 남은 시간·남은 HP 는 **숫자보다 길이로** 보여 준다 — 아이는 숫자를 읽지 않는다.
 */
export class BossBar {
  private readonly root: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly label: HTMLElement;
  private readonly timerRoot: HTMLElement;
  private readonly timerFill: HTMLElement;
  private readonly timerLabel: HTMLElement;
  private readonly stairRoot: HTMLElement;
  private readonly stairFill: HTMLElement;

  constructor(host: HTMLElement) {
    host.insertAdjacentHTML(
      'beforeend',
      `<div class="boss-bar" id="boss-bar" hidden>
         <div class="boss-label" id="boss-label"></div>
         <div class="boss-track"><i id="boss-fill"></i></div>
       </div>
       <div class="timer-bar" id="timer-bar" hidden>
         <div class="timer-label" id="timer-label"></div>
         <div class="timer-track"><i id="timer-fill"></i></div>
       </div>
       <div class="stair-bar" id="stair-bar" hidden>
         <div class="stair-track"><i id="stair-fill"></i></div>
       </div>`,
    );
    this.root = host.querySelector('#boss-bar')!;
    this.fill = host.querySelector('#boss-fill')!;
    this.label = host.querySelector('#boss-label')!;
    this.timerRoot = host.querySelector('#timer-bar')!;
    this.timerFill = host.querySelector('#timer-fill')!;
    this.timerLabel = host.querySelector('#timer-label')!;
    this.stairRoot = host.querySelector('#stair-bar')!;
    this.stairFill = host.querySelector('#stair-fill')!;
  }

  showBoss(name: string, ratio: number) {
    this.label.textContent = name;
    this.setBossHp(ratio);
    this.root.removeAttribute('hidden');
  }

  setBossHp(ratio: number) {
    this.fill.style.width = `${Math.max(0, Math.min(1, ratio)) * 100}%`;
    // 위험 구간에서 색을 바꿔 "거의 다 잡았다"를 알려 준다
    this.fill.dataset.low = String(ratio <= 0.3);
  }

  hideBoss() {
    this.root.setAttribute('hidden', '');
  }

  /** 남은 시간 비율(1 → 0). Speed·Escape 이벤트에서 쓴다 */
  showTimer(label: string, ratio: number) {
    this.timerLabel.textContent = label;
    this.timerFill.style.width = `${Math.max(0, Math.min(1, ratio)) * 100}%`;
    this.timerFill.dataset.low = String(ratio <= 0.34);
    this.timerRoot.removeAttribute('hidden');
  }

  hideTimer() {
    this.timerRoot.setAttribute('hidden', '');
  }

  /**
   * 계단 타이머 — 한 칸에 머무를 수 있는 남은 시간 (1 → 0).
   *
   * **보스 HP 바와 같은 자리에 둔다.** 둘은 동시에 뜨지 않는다 (보스전에는 계단 타이머가
   * 적용되지 않는다). 바를 층층이 쌓으면 화면 위쪽이 게이지로 덮여 계단이 안 보인다.
   *
   * 라벨이 없다. 이 바는 **줄어드는 것 자체가 메시지**이고, 남은 시간이 2초일 때
   * 글자를 읽을 여유는 없다. 대신 위험 구간에서 색이 바뀌고 깜빡인다.
   */
  showStairTimer(ratio: number) {
    const clamped = Math.max(0, Math.min(1, ratio));
    this.stairFill.style.width = `${clamped * 100}%`;
    this.stairFill.dataset.low = String(clamped <= 0.3);
    this.stairRoot.removeAttribute('hidden');
  }

  hideStairTimer() {
    this.stairRoot.setAttribute('hidden', '');
  }
}
