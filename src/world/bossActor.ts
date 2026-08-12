import * as THREE from 'three';
import type { Actor } from '../three/actor';

/**
 * 3D 보스.
 *
 * **스파이크 A 의 결과가 여기서 쓰인다.** 보스 캐릭터 glb 에는 애니메이션이 없고,
 * 클립 26종은 별도 파일(`boss-anims`)에 있다. 본 이름이 같아 AnimationMixer 가
 * 이름으로 바인딩하므로 출처가 달라도 붙는다.
 *
 * 보스는 계단 **위쪽 칸에 서서** 아래를 본다. 플레이어가 올라오는 길을 막고 있는 자세여야
 * "저걸 넘어야 한다"가 전달된다.
 *
 * ## 좌표 — 이전 구현의 버그
 *
 * 이전에는 플레이어 위치에 `(0, +0.1, −2.2)` 를 더했다. 계단은 한 칸당 `y +0.46`,
 * `z −0.78` 로 **올라가면서 안쪽으로** 뻗는다. z 만 2.2 밀고 y 를 0.1 만 올리면
 * 그 깊이의 계단 표면(약 +1.3y)보다 **1.2유닛 아래**가 되어 보스가 계단 속에 박히거나
 * 허공에 뜬 것처럼 보였다.
 *
 * 지금은 호출하는 쪽이 `stairs.surfaceAt(floor + AHEAD)` 로 계산한 **실제 계단 표면**을
 * 넘긴다. 이 클래스는 좌표를 만들지 않는다 — 계단 형상을 아는 것은 Stairs 뿐이다.
 */

/** 등장 연출 시간(초) */
const SPAWN_SEC = 0.9;
/** 공격 연출 시간(초) */
const ATTACK_SEC = 0.6;
/** 공격 때 플레이어 쪽으로 파고드는 거리(월드 유닛) */
const LUNGE = 0.85;

export class BossActor {
  private readonly actor: Actor;
  /** 서 있어야 하는 자리 (계단 표면) */
  private readonly base = new THREE.Vector3();
  /** 공격 시 향하는 쪽 = 플레이어 위치 */
  private readonly playerAt = new THREE.Vector3();
  private readonly scratch = new THREE.Vector3();
  private spawnLeft = 0;
  private hitLeft = 0;
  private attackLeft = 0;
  private dying = false;

  constructor(actor: Actor) {
    this.actor = actor;
    this.actor.root.visible = false;
  }

  get root(): THREE.Object3D {
    return this.actor.root;
  }

  /**
   * 등장 — 위에서 떨어져 내려온다.
   *
   * @param surface 계단 표면 좌표. 호출하는 쪽이 `stairs.surfaceAt()` 로 구한다
   * @param lookAt  플레이어 위치. 이쪽을 바라보게 돌린다
   */
  spawn(surface: THREE.Vector3, lookAt: THREE.Vector3) {
    this.base.copy(surface);
    this.playerAt.copy(lookAt);
    this.actor.root.position.copy(this.base);
    this.actor.root.position.y += 3;
    this.faceTarget();
    this.actor.root.visible = true;
    this.dying = false;
    this.hitLeft = 0;
    this.attackLeft = 0;
    this.spawnLeft = SPAWN_SEC;
    this.play(['Spawn_Air', 'Idle_A'], { loop: false, timeScale: 1.1 });
  }

  /** 보스전 도중 플레이어 위치가 바뀌면(부활 연출 등) 알려 준다 */
  setTargets(surface: THREE.Vector3, lookAt: THREE.Vector3) {
    this.base.copy(surface);
    this.playerAt.copy(lookAt);
  }

  /** 피격 — 정답 한 번 */
  hit(critical: boolean) {
    if (this.dying) return;
    this.hitLeft = 0.45;
    this.attackLeft = 0;
    this.play([critical ? 'Hit_B' : 'Hit_A', 'Idle_A'], {
      loop: false,
      timeScale: critical ? 1.1 : 1.4,
    });
  }

  /**
   * 공격 — **오답 한 번**.
   *
   * KayKit FREE 팩에는 전용 공격 클립이 없다(26종 전부 확인: Death/Hit/Idle/Interact/
   * PickUp/Spawn/Throw/Use_Item/Jump/Running/Walking). 그래서 `Throw` 를 휘두르는 동작으로
   * 쓰고, **플레이어 쪽으로 파고드는 이동을 코드로 만든다** — 클립만으로는 "때렸다"가
   * 전달되지 않는다. 돌진(0~40%)·복귀(40~100%) 로 나눠 되돌아온다.
   */
  attack() {
    if (this.dying) return;
    this.attackLeft = ATTACK_SEC;
    this.hitLeft = 0;
    this.faceTarget();
    this.play(['Throw', 'Interact', 'Use_Item', 'Idle_B'], { loop: false, timeScale: 1.3 });
  }

  /** 처치 */
  die() {
    this.dying = true;
    this.attackLeft = 0;
    this.play(['Death_A', 'Idle_A'], { loop: false, timeScale: 1.1 });
  }

  hide() {
    this.actor.root.visible = false;
  }

  get visible(): boolean {
    return this.actor.root.visible;
  }

  /** 지금 재생 중인 클립 이름 — 애니메이션이 죽었는지 확인하는 통로 */
  get clip(): string | null {
    return this.actor.playing;
  }

  /** 지금 공격 연출 중인지 — 카메라 흔들림 타이밍을 맞추는 데 쓴다 */
  get attacking(): boolean {
    return this.attackLeft > 0;
  }

  update(dt: number) {
    if (!this.actor.root.visible) return;

    if (this.spawnLeft > 0) {
      this.spawnLeft -= dt;
      const t = 1 - Math.max(0, this.spawnLeft) / SPAWN_SEC;
      // 낙하 — 끝에서 감속
      this.actor.root.position.set(this.base.x, this.base.y + 3 * (1 - t) ** 2, this.base.z);
      if (this.spawnLeft <= 0) this.idle();
    } else if (this.attackLeft > 0) {
      this.attackLeft -= dt;
      const t = 1 - Math.max(0, this.attackLeft) / ATTACK_SEC;
      // 0~0.4 돌진, 0.4~1 복귀
      const reach = t < 0.4 ? t / 0.4 : 1 - (t - 0.4) / 0.6;
      this.scratch.subVectors(this.playerAt, this.base);
      const len = this.scratch.length() || 1;
      this.actor.root.position
        .copy(this.base)
        .addScaledVector(this.scratch, (LUNGE * reach) / len);
      if (this.attackLeft <= 0 && !this.dying) this.idle();
    } else if (!this.dying) {
      // 제자리로 부드럽게 수렴 — 피격 흔들림이 누적되지 않게 한다
      this.actor.root.position.lerp(this.base, 1 - Math.exp(-6 * dt));
    }

    if (this.hitLeft > 0) {
      this.hitLeft -= dt;
      this.actor.root.position.x += Math.sin(this.hitLeft * 60) * 0.04;
      if (this.hitLeft <= 0 && !this.dying) this.idle();
    }

    this.actor.update(dt);
  }

  /**
   * 대기 자세.
   *
   * 매번 `restart` 하지 않는다 — 이미 idle 이면 `Actor.play` 가 그대로 두므로
   * 프레임마다 불러도 안전하다. 그래서 다른 동작이 끝나는 지점마다 호출해
   * **어떤 경로로도 정지 포즈에 굳지 않게** 한다 (loop:false 클립은 마지막 프레임에서
   * 멈추므로, 되돌리지 않으면 보스가 얼어붙은 것처럼 보인다).
   */
  idle() {
    this.play(['Idle_A', 'Idle_B'], { loop: true, timeScale: 0.9 });
  }

  /** 플레이어(아래쪽)를 바라본다 */
  private faceTarget() {
    this.scratch.subVectors(this.playerAt, this.base);
    // 계단은 z 축으로 멀어진다 — 플레이어는 항상 +z 쪽(화면 앞)에 있다
    this.actor.root.rotation.y = Math.atan2(this.scratch.x, this.scratch.z);
  }

  /** 있는 클립 중 첫 번째를 재생한다 — 클립 이름이 팩마다 다를 수 있어 후보를 넘긴다 */
  private play(names: string[], options: { loop?: boolean; timeScale?: number }) {
    for (const name of names) {
      if (this.actor.has(name)) {
        this.actor.play(name, { ...options, fade: 0.1, restart: options.loop !== true });
        return;
      }
    }
  }
}
