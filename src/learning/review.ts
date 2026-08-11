import { emptyProgress, type WordProgress } from './mastery';

/**
 * 복습 스케줄 — **두 개의 큐를 분리한다** (PRD 10장).
 *
 * 하나로 합치면 "30초 후 재출제"와 "3일 후 재출제"가 같은 자료구조에서 싸운다.
 * 성질이 다르기 때문이다.
 *
 * | 큐 | 단위 | 목적 | 저장 |
 * |---|---|---|---|
 * | **세션 내** | 초 | 방금 틀린 단어를 이 판에서 다시 맞히게 한다 | 메모리 (판이 끝나면 버린다) |
 * | **세션 간** | 일 | 망각곡선에 맞춰 다음 판·다음 날 다시 낸다 | localStorage |
 *
 * 세션 간 간격은 SM-2 를 단순화한 것이다. 정확한 SM-2 로 넘어갈 수 있도록
 * `ease` 를 그대로 들고 있는다.
 */

/** 세션 내 재출제 간격(초) — 오답 → 30초 → 5분 */
const SESSION_STEPS_SEC = [30, 300];

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 정답 시 다음 출제까지의 간격. 연속 정답 수(streak)로 단계가 올라간다.
 *
 * **첫 간격이 3분인 이유**: 처음 만나 맞힌 단어를 바로 1일 뒤로 보내면, 그 판에서는
 * 복습 후보가 사라진다(전부 미래 시점이 된다). 그러면 "복습 30%" 비율을 채울 수 없고
 * 한 판이 전부 신규 단어가 된다 — 아이 입장에서는 계속 처음 보는 단어만 나온다.
 * 3분 뒤면 같은 판(3~5분) 후반에 한 번 더 만나고, 그 다음부터 일 단위로 벌어진다.
 */
const INTERVALS_MS = [3 * MINUTE_MS, 1 * DAY_MS, 3 * DAY_MS, 7 * DAY_MS, 21 * DAY_MS, 60 * DAY_MS];

export type SessionDue = { wordId: string; dueAtMs: number; step: number };

export class ReviewQueue {
  /** 세션 내 큐 — 판이 끝나면 사라진다 */
  private session: SessionDue[] = [];

  /**
   * 오답 → 세션 내 큐에 넣는다.
   *
   * 30초 → 5분 → **세션 큐에서 내려보낸다**(다음 게임 이후로) — PRD 10장의 순서다.
   * 세션 안에서 무한히 되돌리면, 아직 실력에 닿지 않는 단어 하나가 그 판의 문제를
   * 계속 차지한다. 시뮬레이션에서 초3 수준 학생의 정답률을 끌어내린 원인이었다.
   * 큐에서 내려가도 세션 간 큐(`dueAt = 지금`)에 남으므로 다음 판에 반드시 다시 만난다.
   */
  pushWrong(wordId: string, nowMs: number) {
    const existing = this.session.find((d) => d.wordId === wordId);
    if (existing) {
      const nextStep = existing.step + 1;
      if (nextStep >= SESSION_STEPS_SEC.length) {
        this.session = this.session.filter((d) => d.wordId !== wordId);
        return;
      }
      existing.step = nextStep;
      existing.dueAtMs = nowMs + SESSION_STEPS_SEC[nextStep] * 1000;
      return;
    }
    this.session.push({ wordId, dueAtMs: nowMs + SESSION_STEPS_SEC[0] * 1000, step: 0 });
  }

  /** 세션 내 정답 → 큐에서 뺀다 */
  clearSession(wordId: string) {
    this.session = this.session.filter((d) => d.wordId !== wordId);
  }

  /** 지금 낼 수 있는 세션 내 복습 단어 (가장 오래 기다린 것부터) */
  dueNow(nowMs: number): string | null {
    const due = this.session
      .filter((d) => d.dueAtMs <= nowMs)
      .sort((a, b) => a.dueAtMs - b.dueAtMs);
    return due.length > 0 ? due[0].wordId : null;
  }

  get sessionSize(): number {
    return this.session.length;
  }

  /** 판이 끝나면 세션 내 큐를 버린다. 세션 간 큐(progress.dueAt)는 남는다 */
  endSession() {
    this.session = [];
  }

  /** 아직 세션 내 복습이 끝나지 않은 단어들 — 결과 화면의 "다시 볼 단어" */
  pendingIds(): string[] {
    return this.session.map((d) => d.wordId);
  }
}

/**
 * 세션 간 스케줄 갱신 (SM-2 축약).
 * 정답이면 간격을 늘리고, 오답이면 처음으로 돌린다.
 */
export function scheduleNext(p: WordProgress, correct: boolean, nowMs: number): WordProgress {
  const next = { ...p, clearedTypes: [...p.clearedTypes] };
  if (correct) {
    next.ease = Math.min(2.8, p.ease + 0.05);
    const step = Math.min(Math.max(next.streak - 1, 0), INTERVALS_MS.length - 1);
    next.dueAt = nowMs + INTERVALS_MS[step] * (next.ease / 2.5);
  } else {
    // 틀린 단어는 **다음 판에 반드시 나온다** (dueAt = 지금)
    next.ease = Math.max(1.6, p.ease - 0.2);
    next.dueAt = nowMs;
  }
  return next;
}

/** 오늘 복습해야 하는 단어 id (세션 간 큐) */
export function dueForReview(
  progress: Record<string, WordProgress>,
  nowMs: number,
): string[] {
  return Object.entries(progress)
    .filter(([, p]) => p.dueAt > 0 && p.dueAt <= nowMs)
    .sort((a, b) => a[1].dueAt - b[1].dueAt)
    .map(([id]) => id);
}

/** 아직 한 번도 안 만난 단어인지 */
export function isNew(progress: Record<string, WordProgress>, wordId: string): boolean {
  const p = progress[wordId];
  return !p || (p.right === 0 && p.wrong === 0);
}

export function progressOf(
  progress: Record<string, WordProgress>,
  wordId: string,
): WordProgress {
  return progress[wordId] ?? emptyProgress();
}
