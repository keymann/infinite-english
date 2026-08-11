/**
 * 사운드 — **오디오 파일을 쓰지 않는다.** Web Audio 로 합성한다.
 *
 * 기준 프로젝트와 같은 판단이다: mp3/ogg 몇 개면 수백 KB 이고, 교실 와이파이에서 그 로딩이
 * 곧 "안 켜지는 게임"이 된다. 합성음은 0바이트다. (impact-sounds 의 발자국은 Phase 5 에서
 * 연출을 다듬을 때 필요하면 넣는다)
 *
 * 브라우저 정책상 소리는 **첫 탭·클릭 이후에만** 난다. 첫 입력에서 자동으로 깨운다.
 */

type Envelope = { attack?: number; decay: number; gain?: number };

export class Sound {
  private ctx: AudioContext | null = null;
  enabled = true;

  /** 첫 사용자 입력에서 호출한다 */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    try {
      this.ctx = new AudioContext();
    } catch {
      // 오디오를 못 쓰는 환경에서도 게임은 돌아야 한다
      this.enabled = false;
    }
  }

  private tone(freq: number, when: number, env: Envelope, type: OscillatorType = 'triangle') {
    const ctx = this.ctx;
    if (!ctx || !this.enabled) return;
    const t = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    const peak = env.gain ?? 0.18;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + (env.attack ?? 0.008));
    gain.gain.exponentialRampToValueAtTime(0.0001, t + env.decay);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + env.decay + 0.02);
  }

  private noise(when: number, decay: number, gainValue: number) {
    const ctx = this.ctx;
    if (!ctx || !this.enabled) return;
    const t = ctx.currentTime + when;
    const length = Math.floor(ctx.sampleRate * decay);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 2;
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = gainValue;
    src.connect(gain).connect(ctx.destination);
    src.start(t);
  }

  /** 정답 — 올라가는 3음. 콤보가 높을수록 높은 음에서 시작해 "쌓인다"는 감각을 준다 */
  correct(combo: number) {
    const base = 523 * Math.pow(1.06, Math.min(combo, 12));
    this.tone(base, 0, { decay: 0.12 });
    this.tone(base * 1.26, 0.06, { decay: 0.12 });
    this.tone(base * 1.5, 0.12, { decay: 0.18 });
  }

  /** 오답 — 내려가는 2음. 벌이 아니라 "아깝다"로 들리게 짧고 부드럽게 */
  wrong() {
    this.tone(320, 0, { decay: 0.16, gain: 0.14 }, 'sine');
    this.tone(240, 0.1, { decay: 0.26, gain: 0.14 }, 'sine');
  }

  /** 계단 착지 */
  step() {
    this.noise(0, 0.06, 0.09);
    this.tone(180, 0, { decay: 0.06, gain: 0.08 }, 'square');
  }

  /** 방향 실수 — 휘청 */
  stumble() {
    this.tone(150, 0, { decay: 0.14, gain: 0.12 }, 'sawtooth');
  }

  /** 콤보 단계 상승 */
  tierUp(tier: number) {
    const base = 660 + tier * 110;
    this.tone(base, 0, { decay: 0.1, gain: 0.16 });
    this.tone(base * 1.5, 0.08, { decay: 0.14, gain: 0.16 });
    this.tone(base * 2, 0.16, { decay: 0.22, gain: 0.14 });
  }

  /** REVIVE 등장 — 긴장 */
  revive() {
    this.tone(196, 0, { decay: 0.5, gain: 0.12 }, 'sine');
    this.tone(294, 0.18, { decay: 0.5, gain: 0.1 }, 'sine');
  }

  gameOver() {
    this.tone(392, 0, { decay: 0.3, gain: 0.14 }, 'sine');
    this.tone(311, 0.22, { decay: 0.35, gain: 0.14 }, 'sine');
    this.tone(262, 0.46, { decay: 0.6, gain: 0.14 }, 'sine');
  }
}
