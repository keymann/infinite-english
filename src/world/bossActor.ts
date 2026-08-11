import * as THREE from 'three';
import type { Actor } from '../three/actor';

/**
 * 3D 보스.
 *
 * **스파이크 A 의 결과가 여기서 쓰인다.** 보스 캐릭터 glb 에는 애니메이션이 없고,
 * 클립 26종은 별도 파일(`boss-anims`)에 있다. 본 이름이 같아 AnimationMixer 가
 * 이름으로 바인딩하므로 출처가 달라도 붙는다 — 그걸 확인하려고 스파이크를 먼저 했다.
 *
 * 보스는 계단 위쪽에 서서 아래를 본다. 플레이어가 올라오는 방향을 막고 있는 자세여야
 * "저걸 넘어야 한다"가 전달된다.
 */

/** 플레이어 기준 배치 — 위쪽·안쪽 */
const OFFSET = new THREE.Vector3(0, 0.1, -2.2);
/** 등장 연출 시간(초) */
const SPAWN_SEC = 0.9;

export class BossActor {
  private readonly actor: Actor;
  private readonly base = new THREE.Vector3();
  private spawnLeft = 0;
  private hitLeft = 0;
  private dying = false;

  constructor(actor: Actor) {
    this.actor = actor;
    this.actor.root.visible = false;
  }

  get root(): THREE.Object3D {
    return this.actor.root;
  }

  /** 등장 — 위에서 떨어져 내려온다 (Spawn_Air 클립이 있으면 사용) */
  spawn(at: THREE.Vector3) {
    this.base.copy(at).add(OFFSET);
    this.actor.root.position.copy(this.base);
    this.actor.root.position.y += 3;
    // 플레이어(아래쪽)를 향해 돌아선다
    this.actor.root.rotation.y = 0;
    this.actor.root.visible = true;
    this.dying = false;
    this.hitLeft = 0;
    this.spawnLeft = SPAWN_SEC;
    this.play(['Spawn_Air', 'Idle_A'], { loop: false, timeScale: 1.1 });
  }

  /** 피격 — 정답 한 번 */
  hit(critical: boolean) {
    if (this.dying) return;
    this.hitLeft = 0.45;
    this.play([critical ? 'Hit_B' : 'Hit_A', 'Idle_A'], { loop: false, timeScale: critical ? 1.1 : 1.4 });
  }

  /** 처치 */
  die() {
    this.dying = true;
    this.play(['Death_A', 'Idle_A'], { loop: false, timeScale: 1.1 });
  }

  hide() {
    this.actor.root.visible = false;
  }

  get visible(): boolean {
    return this.actor.root.visible;
  }

  update(dt: number, playerPos: THREE.Vector3) {
    if (!this.actor.root.visible) return;

    // 플레이어를 따라 위쪽에 머문다 (플레이어가 보스를 지나쳐 오르지 않도록 계단은 잠긴다)
    this.base.copy(playerPos).add(OFFSET);

    if (this.spawnLeft > 0) {
      this.spawnLeft -= dt;
      const t = 1 - Math.max(0, this.spawnLeft) / SPAWN_SEC;
      // 낙하 — 끝에서 감속
      this.actor.root.position.set(
        this.base.x,
        this.base.y + 3 * (1 - t) ** 2,
        this.base.z,
      );
      if (this.spawnLeft <= 0) this.play(['Idle_A'], { loop: true });
    } else if (!this.dying) {
      this.actor.root.position.lerp(this.base, 1 - Math.exp(-6 * dt));
    }

    if (this.hitLeft > 0) {
      this.hitLeft -= dt;
      // 맞는 동안 살짝 흔들린다
      this.actor.root.position.x += Math.sin(this.hitLeft * 60) * 0.04;
      if (this.hitLeft <= 0 && !this.dying) this.play(['Idle_A'], { loop: true });
    }

    this.actor.update(dt);
  }

  /** 있는 클립 중 첫 번째를 재생한다 — 클립 이름이 팩마다 다를 수 있어 후보를 넘긴다 */
  private play(names: string[], options: { loop?: boolean; timeScale?: number }) {
    for (const name of names) {
      if (this.actor.has(name)) {
        this.actor.play(name, { ...options, fade: 0.1, restart: true });
        return;
      }
    }
  }
}
