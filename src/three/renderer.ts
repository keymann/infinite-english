import * as THREE from 'three';
import type { Profile } from './profile';

/**
 * WebGLRenderer 래퍼 — DPR 상한, 리사이즈, 저사양 프로파일 적용.
 *
 * 포스트프로세싱은 쓰지 않는다. 모바일에서 풀스크린 패스 하나가 곧 fill-rate 즉사다.
 */
export class Renderer {
  readonly gl: THREE.WebGLRenderer;
  readonly canvas: HTMLCanvasElement;
  private readonly host: HTMLElement;
  private readonly profile: Profile;
  private onResize: (() => void) | null = null;

  constructor(host: HTMLElement, profile: Profile) {
    this.host = host;
    this.profile = profile;

    this.gl = new THREE.WebGLRenderer({
      antialias: profile.antialias,
      // 계단 배경이 항상 화면을 덮으므로 알파 합성이 필요 없다
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.gl.setPixelRatio(Math.min(devicePixelRatio, profile.dprCap));
    this.gl.shadowMap.enabled = false; // blob 그림자로 대체 (기획서 2장)
    this.canvas = this.gl.domElement;
    host.appendChild(this.canvas);

    this.resize();
    const handler = () => this.resize();
    window.addEventListener('resize', handler);
    window.addEventListener('orientationchange', handler);
    this.onResize = () => {
      window.removeEventListener('resize', handler);
      window.removeEventListener('orientationchange', handler);
    };
  }

  get size(): { w: number; h: number } {
    return { w: this.host.clientWidth, h: this.host.clientHeight };
  }

  resize() {
    const { w, h } = this.size;
    if (w === 0 || h === 0) return;
    this.gl.setPixelRatio(Math.min(devicePixelRatio, this.profile.dprCap));
    this.gl.setSize(w, h, false);
  }

  /** 실제로 그리는 픽셀 수 — fill-rate 측정의 기준값이다 */
  get pixels(): number {
    const { w, h } = this.size;
    const dpr = Math.min(devicePixelRatio, this.profile.dprCap);
    return Math.round(w * dpr) * Math.round(h * dpr);
  }

  dispose() {
    this.onResize?.();
    this.gl.dispose();
    this.canvas.remove();
  }
}
