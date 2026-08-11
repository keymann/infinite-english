import type { Profile } from '../three/profile';

export type HudStats = {
  fps: number;
  calls: number;
  triangles: number;
  pixels: number;
};

/**
 * HUD — 상단에 HP · 층수 · 콤보, 우상단에 성능 패널(개발용).
 *
 * 3D 캔버스 위에 DOM 으로 얹는다. three 로 텍스트를 그리면 폰트 아틀라스·정렬 비용이
 * 붙고 한글 처리가 번거롭다. HUD 는 상태가 바뀔 때만 갱신하면 되므로 DOM 이 옳다.
 */
export class Hud {
  private readonly floorEl: HTMLElement;
  private readonly hpEl: HTMLElement;
  private readonly comboEl: HTMLElement;
  private readonly statsEl: HTMLElement;
  private lastFloor = -1;
  private lastHp = -1;
  private lastCombo = -1;

  constructor(host: HTMLElement, profile: Profile) {
    host.insertAdjacentHTML(
      'beforeend',
      `<div class="hud">
         <div class="hud-top">
           <div class="hud-left">
             <div class="hp" id="hud-hp"></div>
             <div class="floor"><b id="hud-floor">0</b><span>층</span></div>
           </div>
           <div class="hud-right">
             <div class="combo" id="hud-combo"></div>
             <div class="stats" id="hud-stats"></div>
           </div>
         </div>
       </div>`,
    );
    this.floorEl = host.querySelector('#hud-floor')!;
    this.hpEl = host.querySelector('#hud-hp')!;
    this.comboEl = host.querySelector('#hud-combo')!;
    this.statsEl = host.querySelector('#hud-stats')!;
    this.statsEl.dataset.spec = profile.name;
  }

  setFloor(floor: number) {
    if (floor === this.lastFloor) return;
    this.lastFloor = floor;
    this.floorEl.textContent = String(floor);
  }

  /** 하트로 표시한다. 숫자보다 남은 기회가 직관적으로 읽힌다 */
  setHp(hp: number, max: number) {
    if (hp === this.lastHp) return;
    this.lastHp = hp;
    this.hpEl.innerHTML = Array.from(
      { length: max },
      (_, i) => `<span class="heart" data-on="${i < hp}">♥</span>`,
    ).join('');
  }

  setCombo(combo: number) {
    if (combo === this.lastCombo) return;
    this.lastCombo = combo;
    // 2연속 이하는 표시하지 않는다 — 항상 켜져 있는 표시는 정보가 아니다
    this.comboEl.textContent = combo >= 2 ? `${combo} COMBO` : '';
    this.comboEl.dataset.level =
      combo >= 20 ? 'lightning' : combo >= 10 ? 'fire' : combo >= 5 ? 'gold' : 'normal';
  }

  setStats(s: HudStats, profile: Profile) {
    this.statsEl.textContent =
      `${s.fps}fps · ${s.calls}call · ${(s.triangles / 1000).toFixed(1)}k tri · ` +
      `${(s.pixels / 1_000_000).toFixed(2)}Mpx · ${profile.name}/${profile.side}`;
  }
}
