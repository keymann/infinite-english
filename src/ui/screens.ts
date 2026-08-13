import {
  CHARACTERS,
  PETS,
  isUnlocked,
  nextUnlock,
  purchasedCharacters,
  type Collectible,
  type CollectionState,
} from '../progress/collection';
import { GRADE_BANDS, bandOf } from '../learning/gradeBand';
import { allDone, defOf, type MissionState } from '../progress/mission';
import type { ShopState } from '../progress/save';
import { nextGoal, ownedWeapons, shopItem } from '../progress/shop';
import { expRatio, expToNext, type Abilities, type PlayerState } from '../progress/player';
import type { RunState } from '../progress/save';
import type { StreakState } from '../progress/streak';

/**
 * 시작 화면 · 부모용 통계 화면.
 *
 * Phase 6 완료 기준은 "첫 방문자가 설명 없이 한 판을 끝내고, **다음 목표가 화면에 보인다**"다.
 * 그래서 시작 화면에는 세 가지만 크게 둔다: 시작 버튼 · 오늘의 미션 · 다음 해금.
 * 설명은 세 줄이다. 아이는 설명을 읽지 않는다.
 */

export type StartScreenData = {
  player: PlayerState;
  abilities: Abilities;
  missions: MissionState;
  streak: StreakState;
  collection: CollectionState;
  run: RunState | null;
  /** 처음 방문인지 — 설명을 보여 줄지 결정한다 */
  firstTime: boolean;
  /** 지금 고른 문제 레벨 구간 (learning/gradeBand.ts) */
  levelBand: string;
  /** 상점 소유·장착 */
  shop: ShopState;
};

export type StartScreenHandlers = {
  onStart(): void;
  onResume(): void;
  onSelectCharacter(id: string): void;
  onSelectPet(id: string): void;
  onOpenParent(): void;
  /** 문제 레벨 구간을 바꿨다 */
  onSelectBand(id: string): void;
  onOpenShop(): void;
  /** 무기를 골랐다 (null = 없음) */
  onSelectWeapon(id: string | null): void;
};

const escapeHtml = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function collectibleChip(item: Collectible, level: number, selectedId: string, kind: string): string {
  const open = isUnlocked(item, level);
  // 상점에서 산 캐릭터는 레벨 조건이 없다(unlockLevel 0) — 잠금 표기를 붙이지 않는다
  const bought = item.unlockLevel === 0 && item.rig === 'rigMedium';
  return `<button type="button" class="chip" data-kind="${kind}" data-id="${item.id}"
    data-selected="${item.id === selectedId}" ${open ? '' : 'disabled'}>
      <span>${bought ? '⭐ ' : ''}${escapeHtml(item.name)}</span>
      ${open ? '' : `<em>Lv.${item.unlockLevel}</em>`}
    </button>`;
}

export class StartScreen {
  private readonly el: HTMLElement;
  private handlers: StartScreenHandlers | null = null;

  constructor(host: HTMLElement) {
    host.insertAdjacentHTML('beforeend', `<div class="screen" id="start-screen" hidden></div>`);
    this.el = host.querySelector('#start-screen')!;

    this.el.addEventListener('click', (e) => {
      const target = (e.target as HTMLElement).closest('button');
      if (!target || !this.handlers) return;
      const { action, kind, id } = target.dataset;
      if (action === 'start') this.handlers.onStart();
      else if (action === 'resume') this.handlers.onResume();
      else if (action === 'parent') this.handlers.onOpenParent();
      else if (action === 'shop') this.handlers.onOpenShop();
      else if (kind === 'char' && id) this.handlers.onSelectCharacter(id);
      else if (kind === 'pet' && id) this.handlers.onSelectPet(id);
      else if (kind === 'band' && id) this.handlers.onSelectBand(id);
      else if (kind === 'weapon') this.handlers.onSelectWeapon(id ?? null);
    });
  }

  show(data: StartScreenData, handlers: StartScreenHandlers) {
    this.handlers = handlers;
    const { player, missions, streak, collection, run, abilities } = data;
    const next = nextUnlock(player.level);
    const band = bandOf(data.levelBand);
    const goal = nextGoal(player.gold, data.shop.owned);
    const weapons = ownedWeapons(data.shop.owned);
    const equipped = data.shop.weaponId ? shopItem(data.shop.weaponId) : null;
    // 레벨로 열린 캐릭터 + 상점에서 산 캐릭터를 한 목록에 섞는다 — 아이에게는 둘 다 "내 캐릭터"다
    const characters = [...CHARACTERS, ...purchasedCharacters(data.shop.owned)];

    const missionRows = missions.list
      .map((mission) => {
        const def = defOf(mission.id);
        const pct = Math.round((mission.progress / def.target) * 100);
        return `<li data-done="${mission.done}">
            <span class="m-label">${escapeHtml(def.label)}</span>
            <span class="m-count">${mission.progress}/${def.target}</span>
            <span class="m-bar"><i style="width:${pct}%"></i></span>
          </li>`;
      })
      .join('');

    this.el.innerHTML = `
      <div class="screen-card">
        <header class="title">
          <h1>영어계단</h1>
          <p class="sub">계단을 오르며 영어 단어를 익혀요</p>
        </header>

        <div class="level-row">
          <div class="lv">Lv.<b>${player.level}</b></div>
          <div class="exp"><i style="width:${Math.round(expRatio(player) * 100)}%"></i></div>
          <div class="exp-text">${player.exp}/${expToNext(player.level)}</div>
          <div class="gold">🪙 ${player.gold}</div>
        </div>

        <div class="abilities">
          <div><dt>STR</dt><dd>${abilities.str}</dd><small>최고 연속 정답</small></div>
          <div><dt>SPEED</dt><dd>${abilities.speed}</dd><small>빠른 정답</small></div>
          <div><dt>INT</dt><dd>${abilities.int}</dd><small>어려운 단어</small></div>
          <div><dt>MEMORY</dt><dd>${abilities.memory}</dd><small>완전히 익힌 단어</small></div>
        </div>

        <section class="block">
          <h2>문제 난이도</h2>
          <div class="chips bands">
            ${GRADE_BANDS.map(
              (b) => `<button type="button" class="chip" data-kind="band" data-id="${b.id}"
                data-selected="${b.id === band.id}">
                  <span>${escapeHtml(b.label)}</span>
                </button>`,
            ).join('')}
          </div>
          <p class="hint-text">${escapeHtml(band.hint)}${
            band.levels ? '' : ' — 맞히면 어려워지고, 틀리면 쉬워져요'
          }</p>
        </section>

        ${
          run
            ? `<button type="button" class="primary" data-action="resume">이어하기 · ${run.floor}층</button>
               <button type="button" class="secondary" data-action="start">새로 시작</button>`
            : `<button type="button" class="primary" data-action="start">시작하기</button>`
        }

        <button type="button" class="secondary shop-entry" data-action="shop">
          🛒 상점
          ${goal ? `<em>다음 목표 ${escapeHtml(goal.name)} · 🪙 ${goal.price}</em>` : ''}
        </button>

        ${
          data.firstTime
            ? `<ol class="howto">
                 <li>아래 <b>4개 보기</b> 중 뜻이 맞는 것을 누른다</li>
                 <li>맞히면 계단이 열린다 — <b>꺾이는 쪽</b>을 눌러 오른다</li>
                 <li>연속으로 맞히면 한 번에 더 많이 오른다</li>
               </ol>`
            : ''
        }

        <section class="block">
          <h2>오늘의 미션 ${allDone(missions) ? '<span class="chest">🎁 완료!</span>' : ''}</h2>
          <ul class="missions">${missionRows}</ul>
        </section>

        <section class="block">
          <h2>연속 학습 <b>${streak.days}일</b>
            ${streak.shields > 0 ? `<span class="shield">🛡 ${streak.shields}</span>` : ''}
          </h2>
          <p class="hint-text">최고 ${streak.best}일 · 하루 빠져도 방패가 지켜줘요</p>
        </section>

        <section class="block">
          <h2>무기 ${equipped ? `<span class="equipped">${equipped.emoji} ${escapeHtml(equipped.name)}</span>` : ''}</h2>
          <div class="chips">
            <button type="button" class="chip" data-kind="weapon"
              data-selected="${!data.shop.weaponId}">없음</button>
            ${weapons
              .map(
                (w) => `<button type="button" class="chip" data-kind="weapon" data-id="${w.id}"
                  data-selected="${w.id === data.shop.weaponId}">
                    <span>${w.emoji} ${escapeHtml(w.name)}</span>
                  </button>`,
              )
              .join('')}
          </div>
          ${
            weapons.length === 0
              ? `<p class="hint-text">상점에서 무기를 사면 여기에 담겨요. 무기를 들면 보스를 공격해요.</p>`
              : ''
          }

          <h2>캐릭터</h2>
          <div class="chips">
            ${characters.map((c) => collectibleChip(c, player.level, collection.characterId, 'char')).join('')}
          </div>
          <h2>펫</h2>
          <div class="chips">
            ${PETS.map((p) => collectibleChip(p, player.level, collection.petId, 'pet')).join('')}
          </div>
          ${next ? `<p class="hint-text">다음 해금: <b>${escapeHtml(next.name)}</b> — Lv.${next.unlockLevel}</p>` : ''}
        </section>

        <button type="button" class="link" data-action="parent">부모님 화면 (학습 기록)</button>
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

export type ParentReport = {
  questions: number;
  accuracy: number;
  avgAnswerSec: number;
  playMinutes: number;
  playsToday: number;
  learnedWords: number;
  masteredWords: number;
  reviewWords: number;
  recommendedLevel: number;
  bestFloor: number;
  retrySuccess: number;
  weakWords: Array<{ wordId: string; accuracy: number }>;
};

/**
 * 부모용 학습 통계 (PRD 29장).
 *
 * 아이 화면에는 게임만 보여 주고, 여기서만 숫자를 보여 준다.
 * **추천 레벨은 부모 화면에만 있다** — 아이에게 "너는 레벨 4"라고 말하지 않는다 (PRD 3장).
 * 데이터는 전부 이 기기 안에서 계산한다. 서버로 보내지 않는다 (PRD 31장).
 */
export class ParentScreen {
  private readonly el: HTMLElement;

  constructor(host: HTMLElement, onClose: () => void) {
    host.insertAdjacentHTML('beforeend', `<div class="screen" id="parent-screen" hidden></div>`);
    this.el = host.querySelector('#parent-screen')!;
    this.el.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('[data-action="close"]')) onClose();
    });
  }

  show(report: ParentReport, wordOf: (id: string) => string) {
    const pct = (n: number) => `${Math.round(n * 100)}%`;
    const weak = report.weakWords
      .map(
        (w) =>
          `<li><span>${escapeHtml(wordOf(w.wordId))}</span><b>${w.accuracy}%</b>
             <i style="width:${w.accuracy}%"></i></li>`,
      )
      .join('');

    this.el.innerHTML = `
      <div class="screen-card">
        <header class="title">
          <h1>학습 기록</h1>
          <p class="sub">이 기기에만 저장됩니다. 서버로 전송하지 않습니다.</p>
        </header>

        <dl class="report">
          <div><dt>총 플레이</dt><dd>${report.playMinutes}분</dd></div>
          <div><dt>오늘 플레이</dt><dd>${report.playsToday}회</dd></div>
          <div><dt>푼 문제</dt><dd>${report.questions}개</dd></div>
          <div><dt>정답률</dt><dd>${pct(report.accuracy)}</dd></div>
          <div><dt>평균 풀이 시간</dt><dd>${report.avgAnswerSec}초</dd></div>
          <div><dt>만난 단어</dt><dd>${report.learnedWords}개</dd></div>
          <div><dt>완전히 익힌 단어</dt><dd>${report.masteredWords}개</dd></div>
          <div><dt>복습 중인 단어</dt><dd>${report.reviewWords}개</dd></div>
          <div><dt>오답 재학습 성공률</dt><dd>${pct(report.retrySuccess)}</dd></div>
          <div><dt>최고 도달 층수</dt><dd>${report.bestFloor}층</dd></div>
          <div class="wide"><dt>현재 추천 수준</dt><dd>Lv.${report.recommendedLevel} / 10</dd></div>
        </dl>

        <section class="block">
          <h2>자주 틀리는 단어</h2>
          ${weak ? `<ul class="weak">${weak}</ul>` : '<p class="hint-text">아직 취약 단어가 없습니다.</p>'}
        </section>

        <p class="hint-text">
          "완전히 익힌 단어"는 영어→한국어, 한국어→영어를 모두 맞히고
          <b>하루 뒤에 다시 맞힌</b> 단어입니다. 한 번 맞힌 것으로는 세지 않습니다.
        </p>

        <button type="button" class="primary" data-action="close">닫기</button>
      </div>`;
    this.el.removeAttribute('hidden');
  }

  hide() {
    this.el.setAttribute('hidden', '');
  }
}
