import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { createRng } from '../core/rng';
import { LearningEngine } from '../learning/engine';
import { WordBank } from '../learning/words';
import { RunItems } from '../progress/items';
import { Actor } from '../three/actor';
import { Stairs } from '../world/stairs';
import { CLIMB } from './balance';
import { BOSS_KINDS } from './bossRoster';
import { Climb } from './climb';
import { Session } from './session';

/**
 * PR #17 교차 리뷰(Codex · Claude)에서 나온 medium 이슈의 회귀 테스트.
 * 화면 연출(main.ts)에 걸린 두 건 — 별 사용 조건(gaugeOn)·물약 후 저장 — 은
 * 브라우저 검증으로 확인했고, 규칙으로 떼어 낼 수 있는 것만 여기서 고정한다.
 */

describe('이어하기 — 판당 아이템 제한이 풀리지 않는다', () => {
  it('저장한 사용 횟수로 되살리면 남은 횟수가 그대로다', () => {
    const run = new RunItems();
    const inv = run.absorbMistake({ shield: 2 })!;
    const resumed = new RunItems(run.snapshot());
    expect(resumed.left('shield', inv)).toBe(0);
    expect(resumed.absorbMistake(inv)).toBeNull();
  });

  it('기록이 없던 저장본(옛 판)은 새 판처럼 읽는다', () => {
    expect(new RunItems(undefined).left('star', { star: 3 })).toBe(2);
  });

  it('깨진 기록은 0~perRun 으로 잘라 읽는다', () => {
    const run = new RunItems({ star: 99, key: -4 } as never);
    expect(run.usedCount('star')).toBe(2);
    expect(run.usedCount('key')).toBe(0);
  });
});

describe('보스 층 착지 — 버퍼 입력을 버린다', () => {
  function setup(onLand: (climb: Climb) => void) {
    const stairs = new Stairs([], createRng(20260812));
    let wrong = 0;
    const climb: Climb = new Climb(stairs, new Actor(new THREE.Object3D(), []), {
      onLand: () => onLand(climb),
      onWrongDir: () => wrong++,
    });
    const settle = () => {
      for (let i = 0; i < 20 && climb.state === 'jump'; i++) climb.update(CLIMB.jumpSec / 4);
    };
    return { climb, settle, wrong: () => wrong };
  }

  it('착지 콜백이 버퍼를 비우면 버퍼의 틀린 방향이 판을 끝내지 않는다', () => {
    const { climb, settle, wrong } = setup((c) => c.clearBuffer());
    climb.input(climb.nextDir);
    // 점프 도중 다음 칸의 **틀린** 방향을 미리 눌렀다 (버퍼에 들어간다)
    climb.update(CLIMB.jumpSec * 0.75); // 착지 직전 — 입력 버퍼(0.12초)가 착지까지 살아 있다
    // 점프가 시작되면 floor 가 이미 올라 있어 nextDir 은 다음 칸 기준이다
    climb.input(climb.nextDir === 1 ? -1 : 1);
    settle();
    expect(wrong()).toBe(0);
    expect(climb.state).toBe('stand');
    expect(climb.floor).toBe(1);
  });

  it('비우지 않으면 (예전 동작) 버퍼의 틀린 방향이 그대로 처리된다 — 테스트가 경로를 실제로 탄다', () => {
    const { climb, settle, wrong } = setup(() => {});
    climb.input(climb.nextDir);
    climb.update(CLIMB.jumpSec * 0.75);
    // 점프가 시작되면 floor 가 이미 올라 있어 nextDir 은 다음 칸 기준이다
    climb.input(climb.nextDir === 1 ? -1 : 1);
    settle();
    expect(wrong()).toBe(1);
  });
});

describe('대체 보스 — 규칙을 화면의 종에 맞춘다', () => {
  const bank = new WordBank();
  const make = async () => {
    await bank.loadLevels([1, 2]);
    const engine = new LearningEngine(bank, createRng(31), () => 1_700_000_000_000);
    return new Session(bank, engine, createRng(32), () => 1_700_000_000_000);
  };

  it('흡혈귀 대신 오크가 나오면 회복하지 않는다', async () => {
    const session = await make();
    session.startBoss(410); // 410층 = 흡혈귀
    expect(session.bossPick?.kind.id).toBe('vampire');
    expect(session.boss?.regen).toBe(true);

    session.substituteBoss(BOSS_KINDS.orc);
    expect(session.bossPick?.kind.id).toBe('orc');
    expect(session.boss?.regen).toBe(false);
  });

  it('지팡이 봉인도 대신 나온 종 기준으로 다시 판정한다', async () => {
    const session = await make();
    session.weapon = { bonus: 1, family: 'staff' };
    session.startBoss(410);
    expect(session.opening?.sealed).toBe(true);
    session.substituteBoss(BOSS_KINDS.orc);
    expect(session.opening?.sealed).toBe(false);
  });

  it('대보스 여부(HP·보상)는 층이 정한 대로 남는다', async () => {
    const session = await make();
    session.startBoss(400);
    const max = session.boss!.maxHp;
    session.substituteBoss(BOSS_KINDS.zombie);
    expect(session.bossPick?.giant).toBe(true);
    expect(session.boss!.maxHp).toBe(max);
  });
});
