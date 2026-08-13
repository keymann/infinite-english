import {
  SHOP_CATEGORIES,
  affordable,
  itemsOf,
  type ShopCategory,
  type ShopItem,
} from '../progress/shop';

/**
 * 상점 화면 — 골드로 무기·캐릭터를 산다.
 *
 * 목록은 **가격 오름차순**이다(`itemsOf` 가 정렬한다). 아이가 위에서부터 훑으면
 * "지금 살 수 있는 것"을 먼저 만나고, 아래로 갈수록 다음 목표가 된다.
 *
 * 세 가지를 한 줄에 보여 준다: 이름 · 가격 · **지금 살 수 있는지**.
 * 살 수 없는 것은 "얼마나 남았는지"를 적는다 — 목표가 숫자로 보이면 골드를 모을 이유가 생긴다.
 */

const escapeHtml = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export type ShopHandlers = {
  onBuy(id: string): void;
  onClose(): void;
};

function itemRow(item: ShopItem, gold: number, owned: boolean): string {
  const can = affordable(item, gold);
  const left = item.price - gold;
  return `<li class="shop-item" data-can="${can}" data-owned="${owned}">
      <span class="shop-emoji" aria-hidden="true">${item.emoji}</span>
      <span class="shop-text">
        <b>${escapeHtml(item.name)}</b>
        <small>${escapeHtml(item.hint)}</small>
      </span>
      ${
        owned
          ? `<span class="shop-buy"><em class="shop-have">가지고 있어요</em></span>`
          : `<span class="shop-buy">
               <span class="shop-price">🪙 ${item.price}</span>
               ${
                 can
                   ? `<button type="button" class="shop-go" data-buy="${item.id}">사기</button>`
                   : `<em class="shop-left">${left} 더 모으기</em>`
               }
             </span>`
      }
    </li>`;
}

function categoryBlock(category: ShopCategory, gold: number, owned: readonly string[]): string {
  const meta = SHOP_CATEGORIES.find((c) => c.id === category)!;
  const items = itemsOf(category);
  return `<section class="block">
      <h2>${escapeHtml(meta.label)} <span class="soon">${items.length}종</span></h2>
      <p class="hint-text">${escapeHtml(meta.hint)}</p>
      <ul class="shop-list">
        ${items.map((i) => itemRow(i, gold, owned.includes(i.id))).join('')}
      </ul>
    </section>`;
}

export class ShopScreen {
  private readonly el: HTMLElement;
  private handlers: ShopHandlers | null = null;

  constructor(host: HTMLElement) {
    host.insertAdjacentHTML('beforeend', `<div class="screen" id="shop-screen" hidden></div>`);
    this.el = host.querySelector('#shop-screen')!;

    this.el.addEventListener('click', (e) => {
      const target = (e.target as HTMLElement).closest('button');
      if (!target || !this.handlers) return;
      if (target.dataset.action === 'close') this.handlers.onClose();
      else if (target.dataset.buy) this.handlers.onBuy(target.dataset.buy);
    });
  }

  show(gold: number, owned: readonly string[], handlers: ShopHandlers) {
    this.handlers = handlers;
    this.el.innerHTML = `
      <div class="screen-card">
        <header class="title">
          <h1>상점</h1>
          <p class="sub">게임을 해서 모은 골드로 꾸며요</p>
        </header>

        <div class="shop-wallet">
          <span>가진 골드</span>
          <b>🪙 ${gold}</b>
        </div>

        <p class="shop-notice">
          무기를 사면 <b>로비에서 골라 들 수 있어요.</b> 무기를 들면 보스를 맞힐 때 공격해요.
          캐릭터를 사면 <b>바로 고를 수 있어요.</b>
        </p>

        ${SHOP_CATEGORIES.map((c) => categoryBlock(c.id, gold, owned)).join('')}

        <button type="button" class="primary" data-action="close">돌아가기</button>
      </div>`;
    this.el.removeAttribute('hidden');
    this.el.scrollTop = 0;
  }

  hide() {
    this.el.setAttribute('hidden', '');
  }

  get visible(): boolean {
    return !this.el.hasAttribute('hidden');
  }
}
