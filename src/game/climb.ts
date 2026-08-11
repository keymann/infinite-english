import * as THREE from 'three';
import type { Dir } from '../core/input';
import type { Actor } from '../three/actor';
import type { Stairs } from '../world/stairs';
import { CLIMB, PLAYER } from './balance';

export type ClimbState = 'stand' | 'jump' | 'stumble';

export type ClimbEvents = {
  onLand?(floor: number): void;
  onStumble?(): void;
};

/**
 * 계단 오르기 상태머신.
 *
 * Phase 1 은 퀴즈 없이 이 루프만 돌린다: 방향 입력 → 맞으면 한 칸 점프, 틀리면 휘청.
 * **틀려도 죽지 않는다.** HP 는 영어 오답 전용이고, 조작 실수는 콤보·시간만 잃는다
 * (기획서 3.2절). 조작 실수로 판이 끝나면 "영어를 틀려서 실패했다"는 인과가 무너진다.
 */
export class Climb {
  floor = 0;
  state: ClimbState = 'stand';
  /** 방향 실수 누적 — 같은 칸에서 3번 틀리면 그냥 올려 보낸다 */
  missesHere = 0;
  totalMisses = 0;

  private timer = 0;
  private readonly from = new THREE.Vector3();
  private readonly to = new THREE.Vector3();
  private readonly stairs: Stairs;
  private readonly actor: Actor;
  private readonly events: ClimbEvents;
  /** 점프 중 들어온 입력을 잠깐 기억한다 — 빠르게 연타할 때 입력이 씹히면 억울하다 */
  private buffered: Dir | null = null;
  private bufferAge = 0;

  constructor(stairs: Stairs, actor: Actor, events: ClimbEvents = {}) {
    this.stairs = stairs;
    this.actor = actor;
    this.events = events;

    this.stairs.surfaceAt(0, this.from);
    this.to.copy(this.from);
    this.actor.root.position.copy(this.from);
    this.actor.play('idle');
  }

  /** 다음 칸으로 가는 정답 방향 */
  get nextDir(): Dir {
    return this.stairs.dirAt(this.floor + 1);
  }

  /** 이어하기 — 중단했던 층으로 옮긴다 (계단 시드가 같아야 같은 계단이다) */
  teleport(floor: number) {
    this.reset();
    this.floor = floor;
    this.stairs.surfaceAt(floor, this.from);
    this.to.copy(this.from);
    this.actor.root.position.copy(this.from);
  }

  /** 다시 시작 — 계단 방향(시드)은 그대로 두고 위치만 되돌린다 */
  reset() {
    this.floor = 0;
    this.state = 'stand';
    this.missesHere = 0;
    this.totalMisses = 0;
    this.timer = 0;
    this.buffered = null;
    this.stairs.surfaceAt(0, this.from);
    this.to.copy(this.from);
    this.actor.root.position.copy(this.from);
    this.actor.root.rotation.y = 0;
    this.actor.play('idle', { fade: 0 });
  }

  input(dir: Dir) {
    if (this.state === 'stand') {
      this.resolve(dir);
    } else if (this.state === 'jump') {
      this.buffered = dir;
      this.bufferAge = 0;
    }
    // 휘청이는 동안의 입력은 버린다 — 페널티가 페널티로 느껴져야 한다
  }

  private resolve(dir: Dir) {
    if (dir === this.nextDir || this.missesHere >= 2) {
      this.startJump();
    } else {
      this.startStumble();
    }
  }

  private startJump() {
    this.floor++;
    this.missesHere = 0;
    this.state = 'jump';
    this.timer = 0;
    this.from.copy(this.actor.root.position);
    this.stairs.surfaceAt(this.floor, this.to);

    // 진행 방향(화면 안쪽 좌/우)을 바라본다
    const dir = Math.sign(this.to.x - this.from.x) || 1;
    this.actor.root.rotation.y = dir > 0 ? -Math.PI * 0.75 : Math.PI * 0.75;
    this.actor.play('jump', { loop: false, fade: 0.05, restart: true, timeScale: 1.6 });
  }

  private startStumble() {
    this.state = 'stumble';
    this.timer = 0;
    this.missesHere++;
    this.totalMisses++;
    this.actor.play('emote-no', { loop: false, fade: 0.05, restart: true, timeScale: 1.4 });
    this.events.onStumble?.();
  }

  update(dt: number) {
    if (this.buffered !== null) {
      this.bufferAge += dt;
      if (this.bufferAge > CLIMB.inputBufferSec) this.buffered = null;
    }

    switch (this.state) {
      case 'jump': {
        this.timer += dt;
        const t = Math.min(1, this.timer / CLIMB.jumpSec);
        const pos = this.actor.root.position;
        pos.lerpVectors(this.from, this.to, t);
        // 포물선 아치 — 직선으로 올라가면 "미끄러지는" 느낌이 난다
        pos.y += Math.sin(t * Math.PI) * CLIMB.hopHeight;

        if (t >= 1) {
          pos.copy(this.to);
          this.state = 'stand';
          this.actor.play('idle', { fade: 0.08 });
          this.events.onLand?.(this.floor);

          const next = this.buffered;
          this.buffered = null;
          if (next !== null) this.resolve(next);
        }
        break;
      }
      case 'stumble': {
        this.timer += dt;
        if (this.timer >= CLIMB.stumbleSec) {
          this.state = 'stand';
          this.actor.play('idle', { fade: 0.1 });
        }
        break;
      }
      case 'stand':
        break;
    }
  }

  get shakeOnLand(): number {
    return PLAYER.landShake;
  }
}
