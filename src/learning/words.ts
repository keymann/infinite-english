/**
 * 단어 DB 로더 · 색인.
 *
 * three·DOM 을 import 하지 않는다 — 학습 로직은 Node(시뮬레이터)에서 그대로 돌아야 한다.
 * 데이터는 `tools/build-words.ts` 가 만든다. 손으로 고치지 말 것.
 */

export type PartOfSpeech =
  | 'noun'
  | 'verb'
  | 'adjective'
  | 'adverb'
  | 'preposition'
  | 'verb_phrase';

export type Word = {
  id: string;
  word: string;
  meaning: string;
  meaningAlt: string[];
  partOfSpeech: PartOfSpeech;
  level: number;
  grade: string;
  difficulty: number;
  frequency: number;
  exampleSentence: string;
  exampleTranslation: string;
  clozeIndex: number;
  synonyms: string[];
  antonyms: string[];
  tags: string[];
  isPhrase: boolean;
  /** 빌드 시 계산된 오답 후보 표제어 (품질 순). 런타임은 섞기만 한다 */
  distractorPool: string[];
  imageAsset: string | null;
};

export class WordBank {
  private readonly byWord = new Map<string, Word>();
  private readonly list: Word[] = [];

  /** 레벨별로 나눠 담아 두므로 필요한 레벨만 받아 온다 */
  async loadLevels(levels: readonly number[]): Promise<void> {
    const loaded = await Promise.all(
      levels.map(async (level) => {
        const mod = (await import(`../data/words/level-${level}.json`)) as { default: Word[] };
        return mod.default;
      }),
    );
    for (const words of loaded) {
      for (const w of words) {
        if (this.byWord.has(w.word)) continue;
        this.byWord.set(w.word, w);
        this.list.push(w);
      }
    }
  }

  get size(): number {
    return this.list.length;
  }

  all(): readonly Word[] {
    return this.list;
  }

  get(word: string): Word | undefined {
    return this.byWord.get(word);
  }

  byId(id: string): Word | undefined {
    return this.list.find((w) => w.id === id);
  }

  /** 난이도 밴드로 고르기 (Phase 4 의 adaptive 가 이 위에 올라간다) */
  inDifficultyRange(min: number, max: number): Word[] {
    return this.list.filter((w) => w.difficulty >= min && w.difficulty <= max);
  }
}
