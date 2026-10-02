import type { ConsumableId } from '../progress/items';

/**
 * 판 안의 아이템 슬롯 — 화면 오른쪽 가장자리에 세로로 놓인다.
 *
 * 화면 좌/우 절반 탭이 계단 조작이다(core/input.ts). 슬롯을 누른 손가락이 **계단 입력으로
 * 새면 방향 실수로 판이 끝난다.** 그래서 슬롯 위의 포인터 이벤트는 전파를 막는다.
 *
 * 버튼은 세 상태를 갖는다: 쓸 수 있음 / 지금은 못 씀(흐리게) / 이 판에서 다 씀(숨김).
 * 방패는 버튼이 아니라 **배지**다 — 실수하는 순간 저절로 쓰인다.
 */

export type ItemSlot = {
  id: ConsumableId;
  icon: string;
  /** 이 판에서 남은 횟수 */
  left: number;
  /** 지금 누를 수 있는지 */
  usable: boolean;
};

export class ItemBar {
  private readonly el: HTMLElement;
  private onUse: ((id: ConsumableId) => void) | null = null;
  private last = '';

  constructor(host: HTMLElement) {
    host.insertAdjacentHTML('beforeend', `<div class="item-bar" id="item-bar" hidden></div>`);
    this.el = host.querySelector('#item-bar')!;

    // 계단 입력(포인터 업에서 판정)으로 새지 않게 막는다
    for (const type of ['pointerdown', 'pointerup', 'pointercancel'] as const) {
      this.el.addEventListener(type, (e) => e.stopPropagation());
    }
    this.el.addEventListener('click', (e) => {
      const button = (e.target as HTMLElement).closest('button');
      if (!button || button.disabled) return;
      this.onUse?.(button.dataset.item as ConsumableId);
    });
  }

  onItem(handler: (id: ConsumableId) => void) {
    this.onUse = handler;
  }

  /** 매 프레임 불러도 된다 — 내용이 같으면 DOM 을 만지지 않는다 */
  render(slots: readonly ItemSlot[]) {
    const visible = slots.filter((s) => s.left > 0);
    const key = visible.map((s) => `${s.id}:${s.left}:${s.usable}`).join('|');
    if (key === this.last) return;
    this.last = key;

    if (visible.length === 0) {
      this.el.setAttribute('hidden', '');
      this.el.innerHTML = '';
      return;
    }
    this.el.removeAttribute('hidden');
    this.el.innerHTML = visible
      .map((s) =>
        s.id === 'shield'
          ? `<span class="item-slot item-passive" title="방향 실수를 한 번 막아요">
               <i>${s.icon}</i><b>${s.left}</b>
             </span>`
          : `<button type="button" class="item-slot" data-item="${s.id}" ${s.usable ? '' : 'disabled'}>
               <i>${s.icon}</i><b>${s.left}</b>
             </button>`,
      )
      .join('');
  }

  hide() {
    this.last = '';
    this.el.setAttribute('hidden', '');
  }

  /** 아이템을 쓴 순간 그 슬롯을 한 번 튕긴다 */
  pulse(id: ConsumableId) {
    const slot = this.el.querySelector<HTMLElement>(id === 'shield' ? '.item-passive' : `[data-item="${id}"]`);
    if (!slot) return;
    slot.classList.remove('pulse');
    void slot.offsetWidth;
    slot.classList.add('pulse');
  }
}
