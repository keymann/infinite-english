import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { createRng } from '../core/rng';
import { Stairs } from '../world/stairs';
import { Actor, KENNEY_VOCAB, RIG_MEDIUM_VOCAB, type ClipVocab } from '../three/actor';
import { BossActor } from '../world/bossActor';
import { CLIMB, PLAYER, STAIR_TIMER, stairTimeFor } from './balance';
import { Climb } from './climb';

/**
 * 계단 조작 규칙 — **방향을 틀리면 판이 끝난다** + 계단 타이머.
 *
 * 이 두 규칙은 눈으로 확인하기 어렵다. "틀린 방향을 눌렀는데 안 죽는다"나
 * "높은 층에서 타이머가 2초 아래로 내려간다"는 화면을 봐서는 놓친다.
 * 그래서 상태머신과 시간 공식을 여기서 직접 검사한다.
 *
 * `Stairs` 는 모델 없이(`sets = []`) 만들어도 `dirAt`·`surfaceAt` 가 순수 계산이라
 * 헤드리스에서 그대로 쓸 수 있다. Actor 만 최소 스텁으로 대체한다.
 */

/**
 * **실제 `Actor`** 를 쓴다 (스텁이 아니다).
 *
 * Climb 은 클립 이름을 직접 부르지 않고 **역할**(`idle`·`jump`·`hurt`·`no`·`attack`)로 부르고,
 * 리그별 사전이 이름으로 옮긴다. 스텁으로 대체하면 그 사전이 검증되지 않는다 —
 * 상점 캐릭터(Rig_Medium)에서 클립 이름이 전부 다르므로 여기가 조용히 깨지면
 * 캐릭터를 사는 순간 애니메이션이 죽는다.
 *
 * @param clipNames 이 리그가 가진 클립 이름
 */
function stubActor(clipNames: readonly string[] = [], vocab: ClipVocab = KENNEY_VOCAB): Actor {
  const root = new THREE.Object3D();
  // 트랙이 없는 빈 클립 — 이름만 있으면 사전 해석을 검사할 수 있다
  const clips = clipNames.map((name) => new THREE.AnimationClip(name, 0.5, []));
  return new Actor(root, clips, undefined, vocab);
}

function makeClimb() {
  const stairs = new Stairs([], createRng(20260812));
  const events = { wrongDir: 0, lands: [] as number[] };
  const climb = new Climb(stairs, stubActor(), {
    onLand: (floor) => events.lands.push(floor),
    onWrongDir: () => events.wrongDir++,
  });
  /** 점프가 끝날 때까지 시간을 흘린다 */
  const settle = () => {
    for (let i = 0; i < 20 && climb.state === 'jump'; i++) climb.update(CLIMB.jumpSec / 4);
  };
  return { climb, stairs, events, settle };
}

describe('방향 오선택 — 판이 끝난다', () => {
  it('맞는 방향이면 한 칸 오른다', () => {
    const { climb, settle, events } = makeClimb();
    climb.input(climb.nextDir);
    settle();
    expect(climb.floor).toBe(1);
    expect(climb.state).toBe('stand');
    expect(events.wrongDir).toBe(0);
  });

  it('틀린 방향이면 층이 오르지 않고 onWrongDir 이 즉시 불린다', () => {
    const { climb, events } = makeClimb();
    const wrong = (climb.nextDir * -1) as 1 | -1;
    climb.input(wrong);
    expect(events.wrongDir).toBe(1);
    expect(climb.floor).toBe(0);
    expect(climb.state).toBe('stumble');
  });

  it('연출이 끝나면 dead 로 굳는다 — stand 로 돌아오지 않는다', () => {
    const { climb } = makeClimb();
    climb.input((climb.nextDir * -1) as 1 | -1);
    climb.update(CLIMB.stumbleSec + 0.01);
    expect(climb.state).toBe('dead');
    // 시간을 더 흘려도 되살아나지 않는다
    climb.update(5);
    expect(climb.state).toBe('dead');
  });

  it('죽은 뒤의 입력은 무시된다 — 계단을 계속 오를 수 없다', () => {
    const { climb, settle } = makeClimb();
    climb.input((climb.nextDir * -1) as 1 | -1);
    climb.update(CLIMB.stumbleSec + 0.01);
    climb.input(climb.nextDir);
    settle();
    expect(climb.floor).toBe(0);
    expect(climb.state).toBe('dead');
  });

  /*
   * 이전 규칙("같은 칸에서 3번 틀리면 그냥 올려 보낸다")이 남아 있으면
   * 세 번째 오선택에서 층이 올라간다. 그 자동 통과가 사라졌음을 고정한다.
   */
  it('3회 실수 자동 통과가 남아 있지 않다', () => {
    const { climb } = makeClimb();
    const wrong = (climb.nextDir * -1) as 1 | -1;
    for (let i = 0; i < 3; i++) {
      climb.input(wrong);
      climb.update(CLIMB.stumbleSec + 0.01);
    }
    expect(climb.floor).toBe(0);
    // 첫 오선택에서 이미 끝났으므로 이벤트는 한 번만 난다
    expect(climb.totalMisses).toBe(1);
  });

  it('reset 하면 다시 오를 수 있다', () => {
    const { climb, stairs, settle } = makeClimb();
    climb.input((climb.nextDir * -1) as 1 | -1);
    climb.update(CLIMB.stumbleSec + 0.01);
    climb.reset();
    expect(climb.state).toBe('stand');
    expect(climb.totalMisses).toBe(0);
    void stairs;
    climb.input(climb.nextDir);
    settle();
    expect(climb.floor).toBe(1);
  });
});

describe('계단 타이머 — 층이 높을수록 짧아지고 하한은 2초', () => {
  it('0층은 시작값 3초', () => {
    expect(stairTimeFor(0)).toBe(STAIR_TIMER.startSec);
    expect(STAIR_TIMER.startSec).toBe(3);
  });

  /* 층당 뺄셈이 아니라 **100층마다 비율**로 줄어든다 (요구 사항 4).
     뺄셈은 시작값을 낮추면 하한에 닿는 층도 같이 당겨져 초반 난이도가 급변한다 */
  it('100층마다 같은 비율로 줄어든다', () => {
    const at = (f: number) => stairTimeFor(f);
    expect(at(100) / at(0)).toBeCloseTo(STAIR_TIMER.ratioPer100Floors, 6);
    expect(at(200) / at(100)).toBeCloseTo(STAIR_TIMER.ratioPer100Floors, 6);
  });

  it('층이 오르면 단조 감소한다', () => {
    for (let floor = 0; floor < 400; floor += 20) {
      expect(stairTimeFor(floor + 20)).toBeLessThanOrEqual(stairTimeFor(floor));
    }
  });

  it('어떤 층에서도 2초 아래로 내려가지 않는다', () => {
    for (const floor of [0, 100, 300, 500, 1000, 9999, 1e6]) {
      expect(stairTimeFor(floor)).toBeGreaterThanOrEqual(STAIR_TIMER.minSec);
    }
  });

  it('하한에 닿은 뒤에는 계속 2초다', () => {
    // 3.0 × 0.88^(층/100) = 2.0 → 층 ≈ 317
    const floorAtMin =
      100 * (Math.log(STAIR_TIMER.minSec / STAIR_TIMER.startSec) / Math.log(STAIR_TIMER.ratioPer100Floors));
    expect(stairTimeFor(floorAtMin)).toBeCloseTo(STAIR_TIMER.minSec, 6);
    expect(stairTimeFor(floorAtMin + 1)).toBe(STAIR_TIMER.minSec);
    expect(stairTimeFor(floorAtMin + 500)).toBe(STAIR_TIMER.minSec);
  });

  /* 요구 사항: "최대값을 낮춘다" — 계단을 오를 때 루즈하지 않아야 한다 */
  it('한 칸 대기 시간이 3초를 넘지 않는다', () => {
    for (const floor of [0, 1, 50, 100, 500]) {
      expect(stairTimeFor(floor)).toBeLessThanOrEqual(3);
    }
  });

  /* 음수 층은 들어올 수 없지만, 들어와도 시작값보다 길어지면 안 된다 */
  it('음수 층에서도 시작값을 넘지 않는다', () => {
    expect(stairTimeFor(-50)).toBe(STAIR_TIMER.startSec);
  });
});

describe('보스 피격 — 보스 공격 모션에 맞춘 플레이어 리액션', () => {
  /** 플레이어 glb 에 실제로 있는 클립 중 피격 후보 */
  const PLAYER_CLIPS = ['idle', 'jump', 'fall', 'crouch', 'emote-no', 'attack-melee-right'];

  function hurtSetup(vocab = KENNEY_VOCAB, clips = PLAYER_CLIPS) {
    const stairs = new Stairs([], createRng(4242));
    const actor = stubActor(clips, vocab);
    const climb = new Climb(stairs, actor, {});
    // 보스는 계단 위쪽(안쪽)에 선다 — 밀려나는 방향이 그 반대여야 한다
    const bossPos = stairs.surfaceAt(3);
    return { climb, actor, stairs, bossPos, at: () => actor.root.position.clone() };
  }

  it('피격 클립을 재생한다 — 전용 클립이 없어 fall 을 쓴다', () => {
    const { climb, actor, bossPos } = hurtSetup();
    climb.hurt(bossPos);
    expect(actor.playing).toBe('fall');
  });

  /**
   * 상점 캐릭터(KayKit Rig_Medium)는 클립 이름이 **완전히 다르다**.
   * 이름을 코드에 박아 두면 캐릭터를 사는 순간 애니메이션이 전부 죽는다.
   */
  it('상점 캐릭터 리그에서는 그 리그의 클립을 쓴다', () => {
    const rigClips = ['Idle_A', 'Jump_Full_Short', 'Hit_A', 'Death_A', 'Throw'];
    const { climb, actor, bossPos } = hurtSetup(RIG_MEDIUM_VOCAB, rigClips);
    climb.hurt(bossPos);
    expect(actor.playing).toBe('Hit_A');
    climb.attack();
    expect(actor.playing).toBe('Throw');
    climb.input((climb.nextDir * -1) as 1 | -1);
    expect(actor.playing).toBe('Death_A');
  });

  it('보스전 정답이면 공격 동작을 낸다 — 무기가 없어도 맨손으로', () => {
    const { climb, actor, bossPos } = hurtSetup();
    void bossPos;
    climb.attack();
    expect(actor.playing).toBe('attack-melee-right');
    expect(climb.attacking).toBe(true);
    // 끝나면 idle 로 되돌린다 (정지 포즈에 굳지 않는다)
    climb.update(0.5);
    expect(climb.attacking).toBe(false);
    expect(actor.playing).toBe('idle');
  });

  /* `emote-no` 는 방향 오선택(판 종료)에 쓴다. 두 사건이 같은 동작이면 아이가 구별하지 못한다 */
  it('방향 오선택과 다른 동작을 쓴다', () => {
    const { climb, actor, bossPos } = hurtSetup();
    climb.hurt(bossPos);
    const hurtClip = actor.playing;
    climb.input((climb.nextDir * -1) as 1 | -1);
    expect(actor.playing).toBe('emote-no');
    expect(hurtClip).not.toBe('emote-no');
  });

  it('보스 반대쪽으로 밀려났다가 제자리로 돌아온다', () => {
    const { climb, bossPos, at } = hurtSetup();
    const home = at();
    climb.hurt(bossPos);

    // 정점(35%)까지 밀린다
    climb.update(CLIMB.hurtSec * 0.35);
    const pushed = at();
    const moved = pushed.distanceTo(home);
    expect(moved).toBeGreaterThan(PLAYER.knockback * 0.8);
    expect(moved).toBeLessThanOrEqual(PLAYER.knockback + 1e-6);
    // 보스에서 멀어지는 쪽이다
    expect(pushed.distanceTo(bossPos)).toBeGreaterThan(home.distanceTo(bossPos));
    // 수평으로만 — 계단 아래로 떨어지면 층과 화면이 어긋난다
    expect(pushed.y).toBeCloseTo(home.y, 6);

    // 끝나면 정확히 제자리
    climb.update(CLIMB.hurtSec);
    expect(at().distanceTo(home)).toBeCloseTo(0, 6);
  });

  it('리액션이 끝나면 idle 로 돌아온다 — 정지 포즈에 굳지 않는다', () => {
    const { climb, actor, bossPos } = hurtSetup();
    climb.hurt(bossPos);
    climb.update(CLIMB.hurtSec + 0.01);
    expect(actor.playing).toBe('idle');
    expect(climb.hurting).toBe(false);
  });

  /**
   * **계단 상태머신을 건드리지 않는다.** 보스전 중 상태는 'stand' 이고, 여기서 상태가
   * 바뀌면 보스를 잡은 뒤 계단이 열리지 않는다.
   */
  it('상태와 층을 바꾸지 않는다', () => {
    const { climb, bossPos } = hurtSetup();
    climb.hurt(bossPos);
    expect(climb.state).toBe('stand');
    expect(climb.floor).toBe(0);
    climb.update(CLIMB.hurtSec + 0.01);
    expect(climb.state).toBe('stand');
    expect(climb.floor).toBe(0);
  });

  it('리액션 중에도 계단을 오를 수 있다 — 점프가 위치를 이어받는다', () => {
    const { climb, bossPos, at, stairs } = hurtSetup();
    climb.hurt(bossPos);
    climb.update(CLIMB.hurtSec * 0.2);
    climb.input(climb.nextDir);
    // 점프가 끝나면 다음 칸 표면에 정확히 선다 (밀린 오프셋이 남지 않는다)
    for (let i = 0; i < 20 && climb.state === 'jump'; i++) climb.update(CLIMB.jumpSec / 4);
    expect(climb.floor).toBe(1);
    expect(at().distanceTo(stairs.surfaceAt(1))).toBeCloseTo(0, 6);
    expect(climb.hurting).toBe(false);
  });

  it('이미 죽었으면 리액션하지 않는다', () => {
    const { climb, bossPos } = hurtSetup();
    climb.input((climb.nextDir * -1) as 1 | -1);
    climb.update(CLIMB.stumbleSec + 0.01);
    expect(climb.state).toBe('dead');
    climb.hurt(bossPos);
    expect(climb.hurting).toBe(false);
  });

  it('reset 하면 리액션이 남지 않는다', () => {
    const { climb, bossPos, at, stairs } = hurtSetup();
    climb.hurt(bossPos);
    climb.update(CLIMB.hurtSec * 0.3);
    climb.reset();
    expect(climb.hurting).toBe(false);
    expect(at().distanceTo(stairs.surfaceAt(0))).toBeCloseTo(0, 6);
  });
});

describe('타격 순간 — 시간이 아니라 애니메이션 진행도로 잰다', () => {
  const BOSS_CLIPS = ['Idle_A', 'Idle_B', 'Throw', 'Hit_A', 'Hit_B', 'Death_A', 'Spawn_Air'];

  function bossSetup() {
    const boss = new BossActor(stubActor(BOSS_CLIPS));
    const surface = new THREE.Vector3(0, 5, -8);
    const player = new THREE.Vector3(0, 4, -6);
    boss.spawn(surface, player);
    // 등장 연출(0.9초)을 끝내 놓는다 — 그 동안은 낙하가 위치의 주인이다
    for (let i = 0; i < 30; i++) boss.update(0.05);
    return { boss };
  }

  it('공격 한 번에 타격 신호가 정확히 한 번 뜬다', () => {
    const { boss } = bossSetup();
    boss.attack();
    let fired = 0;
    for (let i = 0; i < 40; i++) {
      boss.update(0.02);
      if (boss.takeImpact()) fired++;
    }
    expect(fired).toBe(1);
  });

  /** 돌진이 가장 깊이 들어간 시점(40%)이다. 그보다 이르면 닿기 전에 아파한다 */
  it('돌진 정점에서 뜬다 — 시작이나 끝이 아니다', () => {
    const { boss } = bossSetup();
    boss.attack();
    let elapsed = 0;
    let firedAt = -1;
    for (let i = 0; i < 60; i++) {
      boss.update(0.02);
      elapsed += 0.02;
      if (boss.takeImpact()) {
        firedAt = elapsed;
        break;
      }
    }
    expect(firedAt).toBeGreaterThan(0.15);
    expect(firedAt).toBeLessThan(0.35);
  });

  it('신호는 소비된다 — 매 프레임 다시 리액션하지 않는다', () => {
    const { boss } = bossSetup();
    boss.attack();
    for (let i = 0; i < 40; i++) {
      boss.update(0.02);
      if (boss.takeImpact()) break;
    }
    expect(boss.takeImpact()).toBe(false);
  });

  it('공격하지 않으면 신호가 없다', () => {
    const { boss } = bossSetup();
    for (let i = 0; i < 30; i++) {
      boss.update(0.02);
      expect(boss.takeImpact()).toBe(false);
    }
  });

  it('처치되면 남은 신호를 버린다 — 죽은 보스에게 맞지 않는다', () => {
    const { boss } = bossSetup();
    boss.attack();
    boss.update(0.02);
    boss.die();
    for (let i = 0; i < 30; i++) {
      boss.update(0.02);
      expect(boss.takeImpact()).toBe(false);
    }
  });

  it('여러 번 공격하면 그만큼 타격한다', () => {
    const { boss } = bossSetup();
    let fired = 0;
    for (let round = 0; round < 3; round++) {
      boss.attack();
      for (let i = 0; i < 40; i++) {
        boss.update(0.02);
        if (boss.takeImpact()) fired++;
      }
    }
    expect(fired).toBe(3);
  });
});
