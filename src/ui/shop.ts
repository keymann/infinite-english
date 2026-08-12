import {
  SHOP_CATEGORIES,
  affordable,
  itemsOf,
  type ShopCategory,
  type ShopItem,
} from '../progress/shop';

/**
 * 상점 화면 — **UI 만이다.** 구매는 "추가 예정"으로 표기한다 (progress/shop.ts 주석).
 *
 * 살 수 없는 물건을 늘어놓기만 하면 아이는 두 번째 방문에 열지 않는다. 그래서 두 가지를
 * 보이게 한다:
 *  · 지금 가진 골드와 **각 아이템까지 얼마나 남았는지**
 *  · 살 수 있는 것은 "지금 살 수 있어요" 로 구분 — 목표가 눈에 보여야 골드를 모을 이유가 생긴다
 *
 * 화면 구성은 부모 화면(ParentScreen)과 같은 틀을 쓴다 — 카드 하나에 스크롤, 닫기 버튼.
 */

const escapeHtml = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function itemRow(item: ShopItem, gold: number): string {
  const can = affordable(item, gold);
  const left = item.price - gold;
  return `<li class="shop-item" data-can="${can}">
      <span class="shop-emoji" aria-hidden="true">${item.emoji}</span>
      <span class="shop-text">
        <b>${escapeHtml(item.name)}</b>
        <small>${escapeHtml(item.hint)}</small>
      </span>
      <span class="shop-buy">
        <span class="shop-price">🪙 ${item.price}</span>
        ${
          can
            ? `<em class="shop-ok">지금 살 수 있어요</em>`
            : `<em class="shop-left">${left} 더 모으기</em>`
        }
      </span>
    </li>`;
}

function categoryBlock(category: ShopCategory, gold: number): string {
  const meta = SHOP_CATEGORIES.find((c) => c.id === category)!;
  return `<section class="block">
      <h2>${escapeHtml(meta.label)} <span class="soon">추가 예정</span></h2>
      <p class="hint-text">${escapeHtml(meta.hint)}</p>
      <ul class="shop-list">${itemsOf(category).map((i) => itemRow(i, gold)).join('')}</ul>
    </section>`;
}

export class ShopScreen {
  private readonly el: HTMLElement;
  private onClose: (() => void) | null = null;

  constructor(host: HTMLElement, onClose: () => void) {
    host.insertAdjacentHTML('beforeend', `<div class="screen" id="shop-screen" hidden></div>`);
    this.el = host.querySelector('#shop-screen')!;
    this.onClose = onClose;

    this.el.addEventListener('click', (e) => {
      const target = (e.target as HTMLElement).closest('button');
      if (target?.dataset.action === 'close') this.onClose?.();
    });
  }

  show(gold: number) {
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
          아직 <b>구경만</b> 할 수 있어요. 골드는 계속 모아 두면 돼요 —
          정답·체크포인트·보스·미션으로 모입니다.
        </p>

        ${SHOP_CATEGORIES.map((c) => categoryBlock(c.id, gold)).join('')}

        <button type="button" class="primary" data-action="close">돌아가기</button>
      </div>`;
    this.el.removeAttribute('hidden');
  }

  hide() {
    this.el.setAttribute('hidden', '');
  }

  get visible(): boolean {
    return !this.el.hasAttribute('hidden');
  }
}
