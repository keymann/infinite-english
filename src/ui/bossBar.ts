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
       </div>`,
    );
    this.root = host.querySelector('#boss-bar')!;
    this.fill = host.querySelector('#boss-fill')!;
    this.label = host.querySelector('#boss-label')!;
    this.timerRoot = host.querySelector('#timer-bar')!;
    this.timerFill = host.querySelector('#timer-fill')!;
    this.timerLabel = host.querySelector('#timer-label')!;
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
}
