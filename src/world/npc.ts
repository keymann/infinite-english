import * as THREE from 'three';
import { CHECKPOINT_EVERY } from '../game/balance';
import type { Actor } from '../three/actor';
import type { Stairs } from './stairs';

/**
 * 응원 NPC.
 *
 * 다음 체크포인트 옆 섬에 서서 기다린다. 플레이어가 그 층을 지나가면 손을 들어 환호하고,
 * 다음 체크포인트로 옮겨 간다. **한 명을 재사용**한다 — 스킨드 캐릭터는 인스턴싱이 안 되므로
 * 여러 명을 두면 draw call 이 그만큼 늘어난다.
 *
 * 게임 규칙에 관여하지 않는다. "다음 목표가 저기 있다"를 3D 로 보여 주는 장치다 —
 * 층 숫자보다 사람이 서 있는 쪽이 눈에 먼저 들어온다.
 */

/** 계단에서 옆으로 떨어뜨리는 거리 */
const SIDE = 2.6;
/** 환호 시간(초) */
const CHEER_SEC = 2.2;

export class Npc {
  private readonly actor: Actor;
  /**
   * 발밑에 깔아 주는 섬.
   *
   * 계단은 공중에 뜬 구조물이라 지면이 없다. 섬 없이 세우면 **NPC 가 허공에 떠 있어
   * 버그로 보인다** — 배포본에서 실제로 그렇게 보였다. 배경 프롭과 같은 처리를 한다.
   */
  private readonly platform: THREE.Object3D | null;
  private readonly target = new THREE.Vector3();
  /** 이 NPC 가 기다리는 층 */
  private waitingFloor = CHECKPOINT_EVERY;
  private cheerLeft = 0;

  constructor(actor: Actor, stairs: Stairs, platform: THREE.Object3D | null = null) {
    this.actor = actor;
    this.platform = platform;
    if (platform) platform.scale.setScalar(1.25);
    this.actor.play('idle');
    this.moveTo(this.waitingFloor, stairs);
  }

  get root(): THREE.Object3D {
    return this.actor.root;
  }

  get floor(): number {
    return this.waitingFloor;
  }

  private moveTo(floor: number, stairs: Stairs) {
    this.waitingFloor = floor;
    stairs.surfaceAt(floor, this.target);
    // 계단 진행 방향의 반대편에 세운다 — 올라가는 길을 막지 않는다
    const side = -stairs.dirAt(floor + 1);
    this.target.x += side * SIDE;
    this.target.y -= 0.35;
    this.actor.root.position.copy(this.target);
    // 계단 쪽(플레이어가 올라오는 방향)을 본다
    this.actor.root.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;

    if (this.platform) {
      // 섬의 상단면이 NPC 의 발에 닿도록 내려 놓는다
      const box = new THREE.Box3().setFromObject(this.platform);
      const top = box.max.y - this.platform.position.y;
      this.platform.position.set(this.target.x, this.target.y - top, this.target.z);
    }
  }

  /** 플레이어가 층을 올랐다 */
  onFloor(floor: number, stairs: Stairs) {
    if (floor < this.waitingFloor || this.cheerLeft > 0) return;
    this.cheerLeft = CHEER_SEC;
    if (this.actor.has('emote-yes')) {
      this.actor.play('emote-yes', { loop: false, fade: 0.1, restart: true, timeScale: 1.2 });
    }
    // 다음 체크포인트로 옮길 준비 — 환호가 끝나면 이동한다
    void stairs;
  }

  update(dt: number, stairs: Stairs) {
    if (this.cheerLeft > 0) {
      this.cheerLeft -= dt;
      if (this.cheerLeft <= 0) {
        this.actor.play('idle', { fade: 0.15 });
        this.moveTo(this.waitingFloor + CHECKPOINT_EVERY, stairs);
      }
    }
    this.actor.update(dt);
  }

  reset(stairs: Stairs) {
    this.cheerLeft = 0;
    this.actor.play('idle', { fade: 0 });
    this.moveTo(CHECKPOINT_EVERY, stairs);
  }
}
