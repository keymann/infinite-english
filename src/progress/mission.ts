import { createRng } from '../core/rng';
import { dayKey } from './stats';

/**
 * Daily Mission (PRD 21장).
 *
 * 매일 3개를 낸다. 5개를 주면 훑어보지도 않고, 1개면 목표라기보다 통과 절차가 된다.
 * 모두 완료하면 GOLD CHEST.
 *
 * **오늘 할 수 있는 것만 낸다.** "30층 도달"은 아직 10층도 못 간 아이에게는 목표가 아니라
 * 벽이다. 그래서 미션 풀에 최소 조건(minLevel)을 두고 날짜 시드로 뽑는다.
 */

export type MissionId =
  | 'answer20'
  | 'answer40'
  | 'review10'
  | 'combo3'
  | 'combo10'
  | 'floor20'
  | 'floor40'
  | 'master1'
  | 'accuracy80'
  | 'play2'
  | 'boss1';

export type MissionDef = {
  id: MissionId;
  label: string;
  target: number;
  /** 이 캐릭터 레벨 이상에게만 낸다 */
  minLevel: number;
  gold: number;
};

export const MISSION_POOL: MissionDef[] = [
  { id: 'answer20', label: '문제 20개 풀기', target: 20, minLevel: 1, gold: 20 },
  { id: 'answer40', label: '문제 40개 풀기', target: 40, minLevel: 5, gold: 35 },
  { id: 'review10', label: '복습 단어 10개 맞히기', target: 10, minLevel: 2, gold: 25 },
  { id: 'combo3', label: '3연속 정답', target: 3, minLevel: 1, gold: 15 },
  { id: 'combo10', label: '10연속 정답', target: 10, minLevel: 4, gold: 30 },
  { id: 'floor20', label: '20층 도달', target: 20, minLevel: 1, gold: 20 },
  { id: 'floor40', label: '40층 도달', target: 40, minLevel: 6, gold: 35 },
  { id: 'master1', label: '단어 1개 완전히 익히기', target: 1, minLevel: 3, gold: 30 },
  { id: 'accuracy80', label: '정답률 80% 이상으로 한 판', target: 1, minLevel: 2, gold: 25 },
  { id: 'play2', label: '2판 플레이', target: 2, minLevel: 1, gold: 15 },
  // 보스는 20층마다 나온다 — 어느 정도 오를 수 있게 된 뒤에 낸다 (PRD 21장)
  { id: 'boss1', label: '보스 1회 처치', target: 1, minLevel: 5, gold: 40 },
];

/** 하루에 내는 미션 수 */
export const MISSION_COUNT = 3;
/** 전부 완료 시 상자 보상 */
export const CHEST_GOLD = 60;

export type Mission = { id: MissionId; progress: number; done: boolean };

export type MissionState = {
  /** YYYY-MM-DD — 날짜가 바뀌면 새로 뽑는다 */
  day: string;
  list: Mission[];
  chestClaimed: boolean;
};

export function emptyMissions(): MissionState {
  return { day: '', list: [], chestClaimed: false };
}

export function defOf(id: MissionId): MissionDef {
  const def = MISSION_POOL.find((m) => m.id === id);
  if (!def) throw new Error(`미션 정의 없음: ${id}`);
  return def;
}

/**
 * 오늘의 미션을 뽑는다. **날짜를 시드로 쓰므로 같은 날에는 항상 같은 미션이 나온다** —
 * 새로고침해서 쉬운 미션을 뽑는 일이 없어야 한다.
 */
export function rollMissions(nowMs: number, playerLevel: number): MissionState {
  const day = dayKey(nowMs);
  const seed = [...day].reduce((a, c) => a + c.charCodeAt(0) * 31, 7);
  const rng = createRng(seed);

  const pool = MISSION_POOL.filter((m) => m.minLevel <= playerLevel);
  const picked: MissionId[] = [];
  const bag = pool.slice();
  /* 뽑을 개수를 **루프 전에** 정한다. `bag.length` 는 splice 로 줄어들기 때문에
     조건 안에서 다시 읽으면 3개를 요청해도 2개만 뽑힌다 (실제로 그렇게 났다). */
  const count = Math.min(MISSION_COUNT, bag.length);
  while (picked.length < count) {
    const index = Math.floor(rng() * bag.length);
    picked.push(bag.splice(index, 1)[0].id);
  }
  return { day, list: picked.map((id) => ({ id, progress: 0, done: false })), chestClaimed: false };
}

/** 날짜가 넘어갔으면 새로 뽑는다 */
export function ensureToday(state: MissionState, nowMs: number, playerLevel: number): MissionState {
  return state.day === dayKey(nowMs) && state.list.length > 0
    ? state
    : rollMissions(nowMs, playerLevel);
}

/** 한 판이 끝났을 때의 실적 */
export type MissionProgressInput = {
  answered: number;
  retryCorrect: number;
  bestCombo: number;
  floor: number;
  masteredCount: number;
  accuracy: number;
  /** 이 판을 끝냈으므로 플레이 횟수 +1 */
  plays: number;
  /** 이번 판에 처치한 보스 수 */
  bossDefeated: number;
};

/**
 * 미션 진행도를 갱신한다.
 *
 * 누적형(문제 수·복습 수·플레이 횟수)은 더하고, 최고기록형(콤보·층수·정답률)은 큰 값으로
 * 갱신한다. 한 판에서 20층을 두 번 갈 수는 없으니 층수를 더하면 안 된다.
 */
export function applyProgress(
  state: MissionState,
  input: MissionProgressInput,
): { state: MissionState; completed: MissionId[] } {
  const completed: MissionId[] = [];
  const list = state.list.map((mission) => {
    if (mission.done) return mission;
    const def = defOf(mission.id);
    let progress = mission.progress;

    switch (mission.id) {
      case 'answer20':
      case 'answer40':
        progress += input.answered;
        break;
      case 'review10':
        progress += input.retryCorrect;
        break;
      case 'combo3':
      case 'combo10':
        progress = Math.max(progress, input.bestCombo);
        break;
      case 'floor20':
      case 'floor40':
        progress = Math.max(progress, input.floor);
        break;
      case 'master1':
        progress += input.masteredCount;
        break;
      case 'accuracy80':
        // 문제를 5개 이상 푼 판에서만 인정한다 — 1문제 맞히고 100% 는 미션이 아니다
        if (input.answered >= 5 && input.accuracy >= 0.8) progress = 1;
        break;
      case 'play2':
        progress += input.plays;
        break;
      case 'boss1':
        progress += input.bossDefeated;
        break;
    }

    const done = progress >= def.target;
    if (done && !mission.done) completed.push(mission.id);
    return { ...mission, progress: Math.min(progress, def.target), done };
  });

  return { state: { ...state, list }, completed };
}

export function allDone(state: MissionState): boolean {
  return state.list.length > 0 && state.list.every((m) => m.done);
}

/** 완료 보상 합계 (미션 골드 + 전부 완료 시 상자) */
export function rewardFor(completed: MissionId[], chest: boolean): number {
  const missions = completed.reduce((sum, id) => sum + defOf(id).gold, 0);
  return missions + (chest ? CHEST_GOLD : 0);
}
