import { accuracyOf, isMastered, type WordProgress } from './mastery';

/**
 * 취약 단어 (PRD 19·29장).
 *
 * "틀린 적이 있는 단어" 전부를 취약으로 보면 목록이 금방 수십 개가 되어 의미가 없다.
 * **두 번 이상 만났는데 정답률이 낮은 단어**만 취약으로 본다.
 */

/** 취약 판정 정답률 상한 */
export const WEAK_ACCURACY = 0.6;
/** 최소 시도 횟수 — 한 번 틀린 것으로 낙인찍지 않는다 */
export const WEAK_MIN_ATTEMPTS = 2;

export function isWeak(p: WordProgress): boolean {
  const attempts = p.right + p.wrong;
  if (attempts < WEAK_MIN_ATTEMPTS) return false;
  if (isMastered(p)) return false;
  return accuracyOf(p) < WEAK_ACCURACY;
}

/** 정답률이 낮은 순 — 부모용 통계와 보스전 출제에 쓴다 */
export function weakWords(progress: Record<string, WordProgress>): string[] {
  return Object.entries(progress)
    .filter(([, p]) => isWeak(p))
    .sort((a, b) => accuracyOf(a[1]) - accuracyOf(b[1]))
    .map(([id]) => id);
}
