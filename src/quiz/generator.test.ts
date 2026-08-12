import { describe, expect, it } from 'vitest';

import { createRng } from '../core/rng';
import { WordBank } from '../learning/words';
import { generateQuiz, isCorrect } from './generator';
import type { QuizType } from './types';

/**
 * 4지선다 품질 게이트.
 *
 * "오답이 그럴듯해 보인다"만으로는 부족하다. 아래 지표가 깨지면 아이가 **문제를 풀지 않고
 * 편법으로 맞힐 수 있다.**
 *  · 정답 위치가 한쪽으로 몰리면 → 위치를 외운다
 *  · 보기 길이가 정답만 튀면 → "제일 긴 보기"를 고른다
 *  · 동의어가 오답에 섞이면 → 정답을 골랐는데 오답 처리된다 (가장 나쁜 경우)
 */

/*
 * **운영과 같은 범위(L1~10) 를 로드한다.** 일부만 로드하면 안 된다 — `distractorPool` 은
 * 1,000개 전체에서 계산되므로 L5 단어의 후보 12개가 전부 L6 일 수 있다. 실제로 L6~10 을
 * 추가한 직후 `village` 의 후보가 museum 하나만 남아 generateQuiz 가 throw 했다.
 * 그래서 아래 '로드된 DB 안에서 3개 이상' 테스트가 이 실수를 다시 잡는다.
 */
const bank = new WordBank();
await bank.loadLevels([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

const TYPES: QuizType[] = ['EN_TO_KO', 'KO_TO_EN'];

describe('단어 DB', () => {
  it('L1~10 이 로드된다 (1,000개)', () => {
    expect(bank.size).toBe(1000);
  });

  it('모든 단어가 4지선다를 만들 수 있다 (오답 후보 3개 이상)', () => {
    const thin = bank.all().filter((w) => w.distractorPool.length < 3);
    expect(thin.map((w) => w.word)).toEqual([]);
  });

  /* 부분 로드 방지 게이트 — main.ts 의 LEVELS 가 줄어들면 여기서 먼저 깨진다 */
  it('오답 후보가 로드된 DB 안에서 3개 이상 해결된다', () => {
    const thin = bank
      .all()
      .map((w) => ({ w, n: w.distractorPool.filter((p) => bank.get(p)).length }))
      .filter(({ n }) => n < 3);
    expect(thin.map(({ w, n }) => `${w.word}(${n}개)`)).toEqual([]);
  });

  it('오답 후보에 자기 자신이 없다', () => {
    const bad = bank.all().filter((w) => w.distractorPool.includes(w.word));
    expect(bad.map((w) => w.word)).toEqual([]);
  });
});

describe('4지선다 생성', () => {
  /*
   * 게임과 같은 방식으로 **하나의 난수 스트림**에서 연달아 만든다.
   * 문제마다 시드를 새로 만들면 시드가 서로 비슷해져 같은 순열이 반복되고,
   * 셔플이 아니라 시드 선택을 검사하게 된다 (1차 작성에서 실제로 그렇게 됐다).
   */
  const rng = createRng(20260812);
  const quizzes = bank.all().flatMap((word) =>
    TYPES.flatMap((type) =>
      Array.from({ length: 6 }, () => ({ word, quiz: generateQuiz(word, bank, type, rng) })),
    ),
  );

  it('보기는 항상 4개다', () => {
    expect(quizzes.every(({ quiz }) => quiz.choices.length === 4)).toBe(true);
  });

  it('보기 중복이 없다', () => {
    const dup = quizzes.filter(({ quiz }) => new Set(quiz.choices).size !== 4);
    expect(dup.map(({ quiz }) => `${quiz.word}: ${quiz.choices.join('/')}`)).toEqual([]);
  });

  it('정답이 보기에 정확히 하나 있다', () => {
    for (const { word, quiz } of quizzes) {
      const answer = quiz.type === 'EN_TO_KO' ? word.meaning : word.word;
      expect(quiz.choices.filter((c) => c === answer)).toHaveLength(1);
      expect(quiz.choices[quiz.correctIndex]).toBe(answer);
    }
  });

  /** 가장 중요한 검사 — 정답이 둘인 문제가 만들어지면 안 된다 */
  it('동의어·같은 뜻이 오답 보기로 들어가지 않는다', () => {
    const offenders: string[] = [];
    for (const { word, quiz } of quizzes) {
      const forbidden = new Set<string>();
      for (const syn of word.synonyms) {
        const s = bank.get(syn);
        if (!s) continue;
        forbidden.add(quiz.type === 'EN_TO_KO' ? s.meaning : s.word);
      }
      // 뜻 표기가 같은 다른 단어도 금지 (build-words 가 막지만 이중으로 확인한다)
      for (const other of bank.all()) {
        if (other.word === word.word) continue;
        if (other.meaning === word.meaning) {
          forbidden.add(quiz.type === 'EN_TO_KO' ? other.meaning : other.word);
        }
      }
      const hit = quiz.choices.filter((c, i) => i !== quiz.correctIndex && forbidden.has(c));
      if (hit.length) offenders.push(`${word.word}(${quiz.type}) ← ${hit.join(', ')}`);
    }
    expect(offenders).toEqual([]);
  });

  it('정답 위치가 고르게 분포한다 (각 25% ±3%p)', () => {
    const counts = [0, 0, 0, 0];
    for (const { quiz } of quizzes) counts[quiz.correctIndex]++;
    const ratios = counts.map((c) => c / quizzes.length);
    for (const r of ratios) {
      expect(r, `분포: ${ratios.map((x) => (x * 100).toFixed(1) + '%').join(' / ')}`).toBeGreaterThan(0.22);
      expect(r).toBeLessThan(0.28);
    }
  });

  it('정답이 가장 긴 보기이거나 가장 짧은 보기인 비율이 치우치지 않는다', () => {
    let longest = 0;
    let shortest = 0;
    for (const { quiz } of quizzes) {
      const lengths = quiz.choices.map((c) => c.length);
      const answer = lengths[quiz.correctIndex];
      if (answer === Math.max(...lengths) && new Set(lengths).size > 1) longest++;
      if (answer === Math.min(...lengths) && new Set(lengths).size > 1) shortest++;
    }
    // 완전 균등(25%)은 불가능하다. 40% 를 넘으면 "제일 긴 보기를 고르면 된다"가 성립한다
    expect(longest / quizzes.length).toBeLessThan(0.4);
    expect(shortest / quizzes.length).toBeLessThan(0.4);
  });

  it('같은 단어를 여러 번 내면 보기 조합이 달라진다', () => {
    const word = bank.get('apple')!;
    const sets = Array.from({ length: 6 }, (_, k) =>
      generateQuiz(word, bank, 'EN_TO_KO', createRng(k + 1)).choices.join('|'),
    );
    expect(new Set(sets).size).toBeGreaterThan(1);
  });
});

describe('채점', () => {
  it('정답 인덱스를 맞히면 정답이다', () => {
    const word = bank.get('cat')!;
    const quiz = generateQuiz(word, bank, 'EN_TO_KO', createRng(7));
    expect(isCorrect(quiz, quiz.correctIndex, word)).toBe(true);
  });

  it('오답 인덱스는 오답이다', () => {
    const word = bank.get('cat')!;
    const quiz = generateQuiz(word, bank, 'EN_TO_KO', createRng(7));
    const wrong = (quiz.correctIndex + 1) % 4;
    expect(isCorrect(quiz, wrong, word)).toBe(false);
  });

  /** meaningAlt 는 정답으로 인정한다 — 뜻을 하나로 좁히면 억울한 오답이 생긴다 */
  it('meaningAlt 도 정답으로 인정한다', () => {
    const old = bank.get('old')!;
    expect(old.meaningAlt.length).toBeGreaterThan(0);
    const quiz = generateQuiz(old, bank, 'EN_TO_KO', createRng(11));
    const fake = { ...quiz, choices: [...quiz.choices] };
    const slot = (quiz.correctIndex + 1) % 4;
    fake.choices[slot] = old.meaningAlt[0];
    expect(isCorrect(fake, slot, old)).toBe(true);
  });
});
