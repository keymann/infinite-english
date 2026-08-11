import type { Rng } from '../core/rng';
import type { Word, WordBank } from '../learning/words';
import type { Quiz, QuizType } from './types';

/**
 * 4지선다 생성.
 *
 * 오답은 **런타임에 고르지 않는다.** 빌드 시점에 계산해 둔 `distractorPool`(품질 순)에서
 * 앞쪽을 가져와 섞는다. 이유:
 *  1. 매 문제마다 전체 DB 를 훑을 이유가 없다.
 *  2. 오답 품질을 빌드 단계에서 검사할 수 있다 (tools/build-words.ts).
 *  3. 동의어·뜻 겹침 배제가 이미 끝나 있어 **정답이 둘인 문제가 나오지 않는다.**
 */

let counter = 0;

/** Fisher-Yates. 시드 난수를 쓰므로 같은 시드면 같은 보기 순서가 나온다 */
function shuffle<T>(items: T[], rng: Rng): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function generateQuiz(
  word: Word,
  bank: WordBank,
  type: QuizType,
  rng: Rng,
  options: { isRetry?: boolean } = {},
): Quiz {
  const answerOf = (w: Word) => (type === 'EN_TO_KO' ? w.meaning : w.word);

  const pool = word.distractorPool.map((w) => bank.get(w)).filter((w): w is Word => !!w);
  const correct = answerOf(word);

  /*
   * 후보 앞쪽 6개를 섞어 3개를 뽑는다 — 매번 같은 오답이 나오면 답을 외워 버린다.
   * 단, **화면에 표시되는 문자열이 겹치면 안 된다.** `small`(작은)과 `little`(작은)이
   * 같은 문제에 들어가면 보기가 "작은 / 작은" 으로 두 번 나온다.
   * (빌드에서 후보 목록을 뜻 기준으로 이미 걸렀지만, 여기서 한 번 더 막는다 —
   *  보기 중복은 문제를 즉시 망가뜨리므로 이중으로 방어할 값이 있다)
   */
  const seen = new Set<string>([correct]);
  const picked: Word[] = [];
  const take = (candidate: Word) => {
    const text = answerOf(candidate);
    if (seen.has(text)) return;
    seen.add(text);
    picked.push(candidate);
  };

  for (const candidate of shuffle(pool.slice(0, 6), rng)) {
    if (picked.length >= 3) break;
    take(candidate);
  }
  // 앞쪽 6개에서 3개를 못 채웠으면 품질 순으로 계속 내려간다
  for (const candidate of pool.slice(6)) {
    if (picked.length >= 3) break;
    take(candidate);
  }

  if (picked.length < 3) {
    throw new Error(`'${word.word}' 의 오답 후보가 부족하다 (${picked.length}개) — 단어 DB 를 확인할 것`);
  }

  const choices = shuffle([correct, ...picked.map(answerOf)], rng);

  return {
    id: `quiz_${++counter}`,
    type,
    wordId: word.id,
    word: word.word,
    question:
      type === 'EN_TO_KO'
        ? `"${word.word}" 의 뜻은?`
        : `"${word.meaning}" 의 영어는?`,
    choices,
    correctIndex: choices.indexOf(correct),
    difficulty: word.difficulty,
    isRetry: options.isRetry ?? false,
  };
}

/** 채점. `meaningAlt` 도 정답으로 인정한다 — 뜻을 하나로 좁히면 억울한 오답이 생긴다 */
export function isCorrect(quiz: Quiz, choiceIndex: number, word: Word | undefined): boolean {
  if (choiceIndex === quiz.correctIndex) return true;
  if (!word || quiz.type !== 'EN_TO_KO') return false;
  const picked = quiz.choices[choiceIndex];
  return word.meaningAlt.includes(picked);
}
