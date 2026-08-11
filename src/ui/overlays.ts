import type { SessionStats } from '../game/session';

/**
 * 오버레이 — 콤보 배너 · 결과 화면.
 *
 * 결과 화면의 문구가 중요하다. **"GAME OVER" 를 쓰지 않는다** (PRD 25장).
 * 실패를 학습 기회로 느끼게 하는 것이 이 게임의 설계 전제다.
 */
/**
 * 정답 칭찬 문구 (PRD 28장). 콤보가 오를수록 세진다.
 * 매번 같은 "정답!"이면 세 번째부터는 정보가 아니다.
 */
export function praiseFor(combo: number, isRetry: boolean): string {
  if (isRetry) return '기억했어!';
  if (combo >= 20) return 'UNBELIEVABLE!';
  if (combo >= 10) return 'AMAZING!';
  if (combo >= 5) return 'Awesome!';
  if (combo >= 3) return 'Perfect!';
  return '좋아!';
}

export class Overlays {
  private readonly bannerEl: HTMLElement;
  private readonly praiseEl: HTMLElement;
  private readonly resultEl: HTMLElement;
  private bannerTimer = 0;
  private praiseTimer = 0;

  constructor(host: HTMLElement) {
    host.insertAdjacentHTML(
      'beforeend',
      `<div class="banner" id="banner" hidden></div>
       <div class="praise" id="praise" hidden></div>
       <div class="result" id="result" hidden></div>`,
    );
    this.bannerEl = host.querySelector('#banner')!;
    this.praiseEl = host.querySelector('#praise')!;
    this.resultEl = host.querySelector('#result')!;
  }

  /** 정답 즉시 뜨는 짧은 칭찬. 배너(콤보 단계·체크포인트)와 겹치지 않게 쓴다 */
  praise(text: string, style = 'normal') {
    this.praiseEl.textContent = text;
    this.praiseEl.dataset.style = style;
    this.praiseEl.removeAttribute('hidden');
    this.praiseEl.classList.remove('rise');
    void this.praiseEl.offsetWidth;
    this.praiseEl.classList.add('rise');
    clearTimeout(this.praiseTimer);
    this.praiseTimer = setTimeout(
      () => this.praiseEl.setAttribute('hidden', ''),
      700,
    ) as unknown as number;
  }

  /** 콤보 단계 상승 등 짧은 배너 */
  banner(text: string, style: string) {
    if (!text) return;
    this.bannerEl.textContent = text;
    this.bannerEl.dataset.style = style;
    this.bannerEl.removeAttribute('hidden');
    // 애니메이션을 다시 트리거하려면 클래스를 떼고 리플로우를 강제해야 한다
    this.bannerEl.classList.remove('pop');
    void this.bannerEl.offsetWidth;
    this.bannerEl.classList.add('pop');

    clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => this.bannerEl.setAttribute('hidden', ''), 900) as unknown as number;
  }

  /**
   * 결과 화면. 점수보다 **얼마나 배웠는지**를 앞에 둔다.
   * 그리고 "다시" 버튼이 가장 크다 — 한 판 더 하고 싶게 만드는 것이 목표다.
   */
  result(stats: SessionStats, onRestart: () => void) {
    const wrongList = stats.wrongWords.slice(0, 6);
    this.resultEl.innerHTML = `
      <div class="result-card">
        <h2>아깝다!</h2>
        <p class="result-sub">${stats.floor}층까지 올라갔어. 다음엔 더 높이 갈 수 있어.</p>
        <dl class="result-stats">
          <div><dt>최고 층수</dt><dd>${stats.floor}</dd></div>
          <div><dt>점수</dt><dd>${stats.score}</dd></div>
          <div><dt>정답률</dt><dd>${Math.round(stats.accuracy * 100)}%</dd></div>
          <div><dt>최고 콤보</dt><dd>${stats.bestCombo}</dd></div>
        </dl>
        ${
          wrongList.length
            ? `<div class="result-words">
                 <h3>다시 볼 단어 ${stats.wrongWords.length}개</h3>
                 <p>${wrongList.map(escapeHtml).join(' · ')}${stats.wrongWords.length > wrongList.length ? ' …' : ''}</p>
               </div>`
            : `<div class="result-words"><h3>틀린 단어가 없어!</h3></div>`
        }
        <button type="button" class="again" id="again">한 판 더</button>
      </div>`;
    this.resultEl.removeAttribute('hidden');
    this.resultEl.querySelector<HTMLButtonElement>('#again')!.addEventListener('click', onRestart);
  }

  hideResult() {
    this.resultEl.setAttribute('hidden', '');
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
