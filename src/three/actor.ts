import * as THREE from 'three';

export type PlayOptions = {
  /** 반복 재생. false 면 마지막 프레임에서 멈춘다 */
  loop?: boolean;
  /** 이전 동작에서 넘어가는 시간(초) */
  fade?: number;
  timeScale?: number;
  /** 같은 동작을 다시 요청했을 때 처음부터 다시 재생 */
  restart?: boolean;
};

/**
 * 애니메이션 캐릭터. 클립 이름으로 동작을 전환하는 얇은 상태머신.
 *
 * 클립은 이 캐릭터의 glb 에 들어 있을 수도 있고(플레이어: 32종 내장),
 * 별도 파일에서 온 것일 수도 있다(보스: boss-anims 의 26종). 본 이름이 같으면
 * AnimationMixer 가 이름으로 바인딩하므로 출처는 상관없다 — 스파이크 A 에서 검증했다.
 */
export class Actor {
  readonly root: THREE.Object3D;
  /** 스케일 적용 후 실제 키(월드 유닛) */
  readonly height: number;

  private readonly mixer: THREE.AnimationMixer;
  private readonly clips = new Map<string, THREE.AnimationClip>();
  private currentName: string | null = null;
  private current: THREE.AnimationAction | null = null;

  constructor(root: THREE.Object3D, clips: readonly THREE.AnimationClip[], targetHeight?: number) {
    this.root = root;

    // 스키닝 전 바인드 포즈 기준 크기. 모델마다 제작 스케일이 달라 코드에서 맞춘다.
    const box = new THREE.Box3().setFromObject(root);
    const rawHeight = box.max.y - box.min.y;
    if (targetHeight && rawHeight > 0) {
      const s = targetHeight / rawHeight;
      root.scale.setScalar(s);
      this.height = targetHeight;
    } else {
      this.height = rawHeight;
    }

    this.mixer = new THREE.AnimationMixer(root);
    for (const clip of clips) {
      // 같은 이름이 여러 개면 첫 것만 쓴다 (bundle 에 캐릭터가 하나뿐이므로 정상 상황)
      if (!this.clips.has(clip.name)) this.clips.set(clip.name, clip);
    }
  }

  has(name: string): boolean {
    return this.clips.has(name);
  }

  get playing(): string | null {
    return this.currentName;
  }

  play(name: string, options: PlayOptions = {}): void {
    const clip = this.clips.get(name);
    if (!clip) throw new Error(`클립 '${name}' 이 없다. 있는 클립: ${[...this.clips.keys()].join(', ')}`);
    if (this.currentName === name && !options.restart) return;

    const { loop = true, fade = 0.12, timeScale = 1 } = options;
    const next = this.mixer.clipAction(clip);
    next.reset();
    next.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    next.clampWhenFinished = !loop;
    next.timeScale = timeScale;
    next.enabled = true;

    if (this.current && this.current !== next && fade > 0) {
      next.crossFadeFrom(this.current, fade, false);
      next.play();
    } else {
      this.current?.stop();
      next.play();
    }

    this.current = next;
    this.currentName = name;
  }

  update(dt: number) {
    this.mixer.update(dt);
  }
}
