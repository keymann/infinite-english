import * as THREE from 'three';
import type { Actor } from '../three/actor';

/**
 * 펫 동료.
 *
 * 게임 규칙에 관여하지 않는다 — 순수하게 **혼자가 아니라는 감각**을 위한 존재다.
 * 콤보가 오르면 춤을 추고, 플레이어가 오르면 따라 올라온다.
 *
 * 뒤쪽 아래에 붙여 둔다. 앞이나 옆에 두면 다음 계단을 가려서 조작을 방해한다.
 */

/** 플레이어 기준 목표 위치 (뒤쪽 아래) */
const OFFSET = new THREE.Vector3(0.62, -0.12, 1.05);
/** 따라오는 속도(1/초). 느슨하게 잡아야 "따라온다"로 보인다 */
const FOLLOW = 5.5;
/** 춤 지속 시간(초) */
const CHEER_SEC = 1.6;

export class Pet {
  private readonly actor: Actor;
  private readonly target = new THREE.Vector3();
  private readonly prev = new THREE.Vector3();
  private cheerLeft = 0;

  constructor(actor: Actor, playerPos: THREE.Vector3) {
    this.actor = actor;
    this.target.copy(playerPos).add(OFFSET);
    this.actor.root.position.copy(this.target);
    this.prev.copy(this.target);
    this.actor.play('idle');
  }

  get root(): THREE.Object3D {
    return this.actor.root;
  }

  /** 콤보 단계가 올랐다 — 춤 */
  cheer() {
    if (!this.actor.has('dance')) return;
    this.cheerLeft = CHEER_SEC;
    this.actor.play('dance', { fade: 0.08, restart: true, timeScale: 1.3 });
  }

  update(dt: number, playerPos: THREE.Vector3) {
    this.target.copy(playerPos).add(OFFSET);
    const pos = this.actor.root.position;
    const t = 1 - Math.exp(-FOLLOW * dt);
    pos.lerp(this.target, t);

    const moved = pos.distanceTo(this.prev) / Math.max(dt, 1e-4);
    this.prev.copy(pos);

    // 진행 방향을 바라본다. 계단은 화면 안쪽으로 멀어지므로 기본은 뒤돌아선 자세다
    const dx = this.target.x - pos.x;
    this.actor.root.rotation.y = Math.PI + Math.max(-0.6, Math.min(0.6, dx * 1.2));

    if (this.cheerLeft > 0) {
      this.cheerLeft -= dt;
      if (this.cheerLeft <= 0) this.actor.play('idle', { fade: 0.15 });
    } else {
      // 속도로 동작을 고른다 — 상태 플래그를 밖에서 넘기지 않아도 된다
      const want = moved > 1.6 ? 'run' : moved > 0.35 ? 'walk' : 'idle';
      if (this.actor.has(want)) this.actor.play(want, { fade: 0.12 });
    }

    this.actor.update(dt);
  }
}
