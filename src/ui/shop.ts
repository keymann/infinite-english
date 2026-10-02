import { CARRY_MAX, countOf, type ConsumableId, type Inventory } from '../progress/items';
import {
  SHOP_CATEGORIES,
  affordable,
  itemsOf,
  weaponDamage,
  type ShopCategory,
  type ShopItem,
} from '../progress/shop';

/**
 * 상점 화면 — 골드로 무기·캐릭터·아이템을 산다. 아이템은 3개까지 여러 번 살 수 있다.
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

/** 한 줄 설명 밑에 붙는 효과 표시 — 무기는 공격력, 아이템은 가진 개수 */
function effectTag(item: ShopItem, inventory: Inventory): string {
  if (item.category === 'weapon') return `<em class="shop-tag">⚔️ 공격 +${weaponDamage(item.price)}</em>`;
  if (item.category === 'item') {
    const n = countOf(inventory, item.id as ConsumableId);
    return `<em class="shop-tag">가진 개수 ${n}/${CARRY_MAX}</em>`;
  }
  return '';
}

function itemRow(item: ShopItem, gold: number, owned: boolean, inventory: Inventory): string {
  const can = affordable(item, gold);
  const left = item.price - gold;
  return `<li class="shop-item" data-can="${can}" data-owned="${owned}" data-cat="${item.category}">
      <span class="shop-emoji" aria-hidden="true">${item.emoji}</span>
      <span class="shop-text">
        <b>${escapeHtml(item.name)}</b>
        <small>${escapeHtml(item.hint)}</small>
        ${effectTag(item, inventory)}
      </span>
      ${
        owned
          ? `<span class="shop-buy"><em class="shop-have">${item.category === 'item' ? '가득 찼어요' : '가지고 있어요'}</em></span>`
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

/**
 * 소비 아이템은 여러 개 산다 — **3개를 다 채웠을 때만** "가지고 있어요" 로 닫는다.
 * 무기·캐릭터는 한 번 사면 끝이다.
 */
function isHeld(item: ShopItem, owned: readonly string[], inventory: Inventory): boolean {
  if (item.category === 'item') return countOf(inventory, item.id as ConsumableId) >= CARRY_MAX;
  return owned.includes(item.id);
}

function categoryBlock(
  category: ShopCategory,
  gold: number,
  owned: readonly string[],
  inventory: Inventory,
): string {
  const meta = SHOP_CATEGORIES.find((c) => c.id === category)!;
  const items = itemsOf(category);
  return `<section class="block">
      <h2>${escapeHtml(meta.label)} <span class="soon">${items.length}종</span></h2>
      <p class="hint-text">${escapeHtml(meta.hint)}</p>
      <ul class="shop-list">
        ${items.map((i) => itemRow(i, gold, isHeld(i, owned, inventory), inventory)).join('')}
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

  show(gold: number, owned: readonly string[], inventory: Inventory, handlers: ShopHandlers) {
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
          무기를 사면 <b>로비에서 골라 들 수 있어요.</b> 무기를 들면 보스에게 주는 피해가 커져요.
          캐릭터를 사면 <b>바로 고를 수 있어요.</b>
          아이템은 <b>판 안에서 오른쪽 버튼으로 써요.</b> 한 판에 쓰는 횟수는 정해져 있어요.
        </p>

        ${SHOP_CATEGORIES.map((c) => categoryBlock(c.id, gold, owned, inventory)).join('')}

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
