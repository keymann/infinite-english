import * as THREE from 'three';
import type { Dir } from '../core/input';
import type { Actor } from '../three/actor';
import type { Stairs } from '../world/stairs';
import { CLIMB, PLAYER } from './balance';

/**
 * 밀려났다가 제자리로 돌아오는 지점 (0~1).
 *
 * 클립 이름은 여기서 정하지 않는다 — **역할**(`hurt`·`jump`·`no`·`attack`)로 부르고
 * 리그별 사전이 이름으로 옮긴다 (three/actor.ts). 상점 캐릭터(KayKit Rig_Medium)는
 * 기본 캐릭터(Kenney)와 클립 이름이 완전히 달라서, 이름을 여기 박으면 캐릭터를 바꾸는
 * 순간 애니메이션이 전부 죽는다.
 */
const KNOCK_PEAK = 0.35;
/** 공격 동작을 보여 주는 시간(초) — 보스전 정답 리액션 */
const ATTACK_SEC = 0.45;

export type ClimbState = 'stand' | 'jump' | 'stumble' | 'dead';

export type ClimbEvents = {
  onLand?(floor: number): void;
  /**
   * 방향을 틀렸다 — **판이 끝난다.** 호출한 쪽이 연출과 종료를 맡는다.
   *
   * @param onFake 그쪽에 **가짜 계단**이 있었는지. 빈 허공을 디딘 것과 함정을 밟은 것은
   *               원인이 다르므로 종료 화면 문구가 갈린다
   */
  onWrongDir?(onFake: boolean): void;
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
  /** 피격 리액션 남은 시간(초) */
  private hurtLeft = 0;
  /** 공격 동작 남은 시간(초) */
  private attackLeft = 0;
  /** 밀려나는 방향 (수평) */
  private readonly knock = new THREE.Vector3();

  constructor(stairs: Stairs, actor: Actor, events: ClimbEvents = {}) {
    this.stairs = stairs;
    this.actor = actor;
    this.events = events;

    this.stairs.surfaceAt(0, this.from);
    this.to.copy(this.from);
    this.actor.root.position.copy(this.from);
    this.actor.playRole('idle');
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
    this.hurtLeft = 0;
    this.attackLeft = 0;
    this.timer = 0;
    this.buffered = null;
    this.stairs.surfaceAt(0, this.from);
    this.to.copy(this.from);
    this.actor.root.position.copy(this.from);
    this.actor.root.rotation.y = 0;
    this.actor.playRole('idle', { fade: 0 });
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
    // 점프가 피격·공격을 이어받는다 — 두 동작이 위치를 동시에 건드리면 캐릭터가 떤다
    this.hurtLeft = 0;
    this.attackLeft = 0;
    this.state = 'jump';
    this.timer = 0;
    this.from.copy(this.actor.root.position);
    this.stairs.surfaceAt(this.floor, this.to);

    // 진행 방향(화면 안쪽 좌/우)을 바라본다
    const dir = Math.sign(this.to.x - this.from.x) || 1;
    this.actor.root.rotation.y = dir > 0 ? -Math.PI * 0.75 : Math.PI * 0.75;
    this.actor.playRole('jump', { loop: false, fade: 0.05, restart: true, timeScale: 1.6 });
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
    this.hurtLeft = 0;
    this.attackLeft = 0;
    this.totalMisses++;
    this.buffered = null;
    this.actor.playRole('no', { loop: false, fade: 0.05, restart: true, timeScale: 1.4 });
    this.events.onWrongDir?.(this.stairs.hasFake(this.floor + 1));
  }

  /**
   * 보스에게 맞았다 — 피격 리액션.
   *
   * **계단 상태머신을 건드리지 않는다.** 보스전 중에는 입력이 잠겨 있어 상태는 'stand' 이고,
   * 여기서 상태를 바꾸면 보스를 잡은 뒤 계단이 열리지 않는다. 자세와 위치만 흔든다.
   *
   * @param fromPos 때린 쪽(보스) 위치. 그 반대로 밀려난다
   */
  hurt(fromPos: THREE.Vector3) {
    if (this.state === 'dead' || this.state === 'stumble') return;
    this.hurtLeft = CLIMB.hurtSec;
    // 보스 반대 방향 (수평만 — 계단 아래로 떨어지면 층과 화면이 어긋난다)
    this.knock.subVectors(this.to, fromPos).setY(0);
    if (this.knock.lengthSq() < 1e-6) this.knock.set(0, 0, 1);
    this.knock.normalize();
    this.actor.playRole('hurt', { loop: false, fade: 0.06, restart: true, timeScale: 1.5 });
  }

  /** 지금 피격 리액션 중인지 */
  get hurting(): boolean {
    return this.hurtLeft > 0;
  }

  /**
   * 보스전에서 정답을 맞혔다 — **무기를 휘두른다.**
   *
   * 피격과 같은 이유로 계단 상태머신을 건드리지 않는다. 무기를 들지 않았어도 동작은 나온다 —
   * 맨손으로 때리는 것도 "내가 공격했다"를 전달한다.
   */
  attack() {
    if (this.state === 'dead' || this.state === 'stumble') return;
    this.attackLeft = ATTACK_SEC;
    this.hurtLeft = 0;
    this.actor.playRole('attack', { loop: false, fade: 0.05, restart: true, timeScale: 1.4 });
  }

  /** 지금 공격 동작 중인지 */
  get attacking(): boolean {
    return this.attackLeft > 0;
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
          this.actor.playRole('idle', { fade: 0.08 });
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

    /* 피격 리액션 — 밀려났다가 제자리로 돌아온다.
       위치를 직접 쓰는 것은 'stand' 일 때만이다. 점프 중이면 점프가 위치의 주인이다
       (startJump 가 hurtLeft 를 지우므로 여기 들어오지 않는다). */
    /* 공격 동작 — 끝나면 idle 로 되돌린다 (loop:false 클립은 마지막 프레임에서 멈춘다) */
    if (this.attackLeft > 0) {
      this.attackLeft -= dt;
      if (this.attackLeft <= 0 && this.state === 'stand') {
        this.actor.playRole('idle', { fade: 0.12 });
      }
    }

    if (this.hurtLeft > 0) {
      this.hurtLeft -= dt;
      if (this.state === 'stand') {
        const t = 1 - Math.max(0, this.hurtLeft) / CLIMB.hurtSec;
        const push =
          t < KNOCK_PEAK ? t / KNOCK_PEAK : 1 - (t - KNOCK_PEAK) / (1 - KNOCK_PEAK);
        this.actor.root.position
          .copy(this.to)
          .addScaledVector(this.knock, PLAYER.knockback * push);
        if (this.hurtLeft <= 0) {
          // 정지 포즈에 굳지 않게 되돌린다 (loop:false 클립은 마지막 프레임에서 멈춘다)
          this.actor.root.position.copy(this.to);
          this.actor.playRole('idle', { fade: 0.14 });
        }
      }
    }
  }

  get shakeOnLand(): number {
    return PLAYER.landShake;
  }
}
