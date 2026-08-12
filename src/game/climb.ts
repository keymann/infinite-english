import * as THREE from 'three';
import type { Dir } from '../core/input';
import type { Actor } from '../three/actor';
import type { Stairs } from '../world/stairs';
import { CLIMB, PLAYER } from './balance';

export type ClimbState = 'stand' | 'jump' | 'stumble' | 'dead';

export type ClimbEvents = {
  onLand?(floor: number): void;
  /** 방향을 틀렸다 — **판이 끝난다.** 호출한 쪽이 연출과 종료를 맡는다 */
  onWrongDir?(): void;
};

/**
 * 계단 오르기 상태머신.
 *
 * 방향 입력 → 맞으면 한 칸 점프, **틀리면 판이 끝난다.**
 *
 * 이전에는 틀려도 휘청이기만 했다 (PRD 3.2절: "조작 실수로 판이 끝나면 영어를 틀려서
 * 실패했다는 인과가 무너진다"). 그 판단을 **뒤집었다** — 원작의 긴장이 방향 선택에서
 * 오고, 실수해도 죽지 않으면 계단이 그냥 통과 구간이 된다는 요청이었다.
 *
 * 인과 문제는 남는다. 완화 장치를 그대로 둔다:
 *  · `?autodir=1` — 방향 자동 보정. 조작이 어려운 아이는 방향으로 죽지 않는다
 *  · 종료 화면이 "방향을 틀렸다"와 "영어를 틀렸다"를 구분해 보여 준다 (main.ts)
 */
export class Climb {
  floor = 0;
  state: ClimbState = 'stand';
  /** 이번 판에서 방향을 틀린 횟수 — 이제 1 이면 판이 끝난다 (종료 사유 판별용) */
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
    // 'stumble'·'dead' 상태의 입력은 버린다 — 이미 판이 끝났다
  }

  private resolve(dir: Dir) {
    if (dir === this.nextDir) this.startJump();
    else this.fallOff();
  }

  private startJump() {
    this.floor++;
    this.state = 'jump';
    this.timer = 0;
    this.from.copy(this.actor.root.position);
    this.stairs.surfaceAt(this.floor, this.to);

    // 진행 방향(화면 안쪽 좌/우)을 바라본다
    const dir = Math.sign(this.to.x - this.from.x) || 1;
    this.actor.root.rotation.y = dir > 0 ? -Math.PI * 0.75 : Math.PI * 0.75;
    this.actor.play('jump', { loop: false, fade: 0.05, restart: true, timeScale: 1.6 });
  }

  /**
   * 방향을 틀렸다 — 판이 끝난다.
   *
   * 즉시 `dead` 로 가지 않고 `stumble` 을 거치는 이유: 아이가 **무엇을 틀렸는지 볼 시간**이
   * 필요하다. 이 동안 입력은 받지 않으므로 다음 칸으로 올라가지지는 않는다.
   */
  private fallOff() {
    this.state = 'stumble';
    this.timer = 0;
    this.totalMisses++;
    this.buffered = null;
    this.actor.play('emote-no', { loop: false, fade: 0.05, restart: true, timeScale: 1.4 });
    this.events.onWrongDir?.();
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
        // 연출이 끝나면 'dead' 로 굳는다. 'stand' 로 돌아가지 않는다 — 판은 이미 끝났다
        this.timer += dt;
        if (this.timer >= CLIMB.stumbleSec) this.state = 'dead';
        break;
      }
      case 'stand':
      case 'dead':
        break;
    }
  }

  get shakeOnLand(): number {
    return PLAYER.landShake;
  }
}
