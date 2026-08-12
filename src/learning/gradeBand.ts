import type { Word } from './words';

/**
 * 문제 레벨 선택 — 로비에서 아이가 고른다.
 *
 * ## 왜 레벨이 아니라 학년인가
 *
 * 단어 DB 의 레벨은 1~10 이지만, **아이에게 "레벨 7" 은 아무 의미가 없다.**
 * PRD 3장은 아이 화면에 등급을 노출하지 않는다고 정했다(추천 레벨은 부모 화면에만 있다).
 * 그래서 선택지는 학년 구간으로 보여 준다 — "초3~초4" 는 아이도 부모도 안다.
 *
 * 구간은 시드 데이터의 실제 학년 매핑에서 나왔다:
 * L1 초3 / L2·L3 초4 / L4 초5 / L5 초6 / L6·L7 중1 / L8·L9 중2 / L10 중3.
 *
 * ## 기본값은 '자동'이다
 *
 * 고르지 않으면 adaptive(theta)가 정한다 — 그것이 정답률 75~85% 를 맞추는 장치이고,
 * 사람이 고른 구간보다 정확하다. 선택은 **그 위에 씌우는 상한·하한**이다:
 * "우리 아이는 초등인데 중등 단어가 나온다" 같은 상황을 부모가 직접 막을 수 있게 한다.
 */

export type BandId = 'auto' | 'e34' | 'e56' | 'm1' | 'm23';

export type GradeBand = {
  id: BandId;
  /** 아이가 보는 이름 */
  label: string;
  /** 한 줄 설명 */
  hint: string;
  /** 출제할 레벨. null 이면 제한 없음(자동) */
  levels: readonly number[] | null;
};

export const GRADE_BANDS: readonly GradeBand[] = [
  { id: 'auto', label: '자동', hint: '실력에 맞춰 알아서', levels: null },
  { id: 'e34', label: '초3~4', hint: '기초 단어', levels: [1, 2, 3] },
  { id: 'e56', label: '초5~6', hint: '생활 단어', levels: [4, 5] },
  { id: 'm1', label: '중1', hint: '중학 기초', levels: [6, 7] },
  { id: 'm23', label: '중2~3', hint: '중학 심화', levels: [8, 9, 10] },
] as const;

const BY_ID = new Map(GRADE_BANDS.map((b) => [b.id, b]));

export function bandOf(id: string): GradeBand {
  return BY_ID.get(id as BandId) ?? GRADE_BANDS[0];
}

/** 그 구간이 허용하는 레벨 (자동이면 null) */
export function levelsOf(id: string): readonly number[] | null {
  return bandOf(id).levels;
}

/**
 * 구간으로 단어를 걸러낸다.
 *
 * **비면 원본을 그대로 돌려준다.** 선택은 취향이고, 게임이 멈추는 것보다 약하다 —
 * 초3 구간을 고른 아이의 복습 큐에 중등 단어만 남아 있으면 그거라도 내야 한다.
 */
export function inBand<T extends Pick<Word, 'level'>>(
  words: readonly T[],
  levels: readonly number[] | null,
): readonly T[] {
  if (!levels) return words;
  const filtered = words.filter((w) => levels.includes(w.level));
  return filtered.length > 0 ? filtered : words;
}
