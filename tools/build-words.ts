/**
 * 단어 DB 빌드 — `npm run words`
 *
 * tools/seed/*.tsv (편집 대상) → src/data/words/level-N.json (게임이 읽는 산출물)
 *
 * 이 스크립트의 존재 이유는 변환이 아니라 **검증**이다. 단어 데이터의 오류는 코드 버그보다
 * 위험하다 — "정답을 골랐는데 오답 처리"되는 문제는 아이가 자기 실력을 의심하게 만든다.
 * 그래서 의심스러운 데이터는 경고로 넘기지 않고 **빌드를 실패시킨다.**
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SEED_DIR = join(ROOT, 'tools', 'seed');
const OUT_DIR = join(ROOT, 'src', 'data', 'words');
const FOOD_MANIFEST = join(ROOT, 'public', 'models', 'manifest.json');

/* ── 타입 ── */

type Pos = 'noun' | 'verb' | 'adjective' | 'adverb' | 'preposition' | 'verb_phrase';
type Freq = 'high' | 'mid' | 'low';

type Seed = {
  word: string;
  level: number;
  grade: string;
  pos: Pos;
  meaning: string;
  meaningAlt: string[];
  synonyms: string[];
  tags: string[];
  freq: Freq;
  example: string;
  exampleKo: string;
  image: string | null;
  /** 진단 메시지용 */
  origin: string;
};

type Word = {
  id: string;
  word: string;
  meaning: string;
  meaningAlt: string[];
  partOfSpeech: Pos;
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
  distractorPool: string[];
  imageAsset: string | null;
};

/* ── 검증 규칙 상수 ── */

const MAX_EXAMPLE_WORDS = { elementary: 8, middle: 12 };
/** 4지선다를 만들려면 최소 3개가 필요하다. 여유를 두고 6개를 요구한다 */
const MIN_DISTRACTORS = 6;
const POOL_SIZE = 12;
/** 아동 대상이므로 게임에 들어가면 안 되는 어휘 */
const BANNED = ['kill', 'gun', 'blood', 'drug', 'war', 'die', 'dead', 'sex', 'hate'];
/**
 * 예문에 등장해도 되는 기능어. 이 목록과 단어 DB 에 없는 **내용어**가 3개 이상이면
 * 예문이 표제어보다 어려운 것이다.
 */
const FUNCTION_WORDS = new Set(
  `a an the this that these those i you he she it we they me him her us them my your his its our their
   is am are was were be been do does did done have has had will would can could should may might must
   not no and or but if so because when where what who how why then than as of in on at to for from with
   by about into over under up down out off very too much many more most some any all every each other others
   there here now again also just only please let us do not don't its it's one two three ten seven
   very good well after before near hard fast high low long slow`
    .split(/\s+/)
    .filter(Boolean),
);

/* ── TSV 파싱 ── */

/**
 * CSV 가 아니라 TSV 다. 한국어 뜻·예문 번역에 쉼표가 흔해서 CSV 의 따옴표 이스케이프가
 * 곧 데이터 오류가 된다 (tools/seed/README.md).
 */
function parseSeedFile(path: string, file: string): Seed[] {
  const lines = readFileSync(path, 'utf8').split('\n');
  const header = lines[0].split('\t').map((h) => h.trim());
  const rows: Seed[] = [];

  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw.trim() || raw.startsWith('#')) continue;
    const cells = raw.split('\t');
    const get = (name: string) => {
      const idx = header.indexOf(name);
      return idx >= 0 ? (cells[idx] ?? '').trim() : '';
    };
    const list = (name: string) =>
      get(name)
        .split('|')
        .map((s) => s.trim())
        .filter(Boolean);

    rows.push({
      word: get('word'),
      level: Number(get('level')),
      grade: get('grade'),
      pos: get('pos') as Pos,
      meaning: get('meaning'),
      meaningAlt: list('meaningAlt'),
      synonyms: list('synonyms'),
      tags: list('tags'),
      freq: (get('freq') || 'mid') as Freq,
      example: get('example'),
      exampleKo: get('exampleKo'),
      image: get('image') || null,
      origin: `${file}:${i + 1}`,
    });
  }
  return rows;
}

/* ── 도우미 ── */

/**
 * 뜻 비교용 정규화. **괄호는 지우지 않는다** — `눈(신체)` 와 `눈(날씨)` 는 화면에 다르게
 * 보이므로 아이가 구별할 수 있고, 따라서 서로의 오답 보기가 되어도 된다.
 * 반대로 표기가 완전히 같은 두 뜻은 KO→EN 문제에서 정답이 둘이 되어 버린다.
 */
const normMeaning = (m: string) => m.replace(/\s+/g, ' ').trim();
/** 동음이의 탐지용 — 괄호 안 구분자를 떼고 본다 */
const baseMeaning = (m: string) => normMeaning(m).replace(/\s*\([^)]*\)\s*/g, '');

const tokenize = (sentence: string) =>
  sentence
    .toLowerCase()
    .replace(/[^a-z' ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

/** 표제어가 예문에 들어 있는 위치(토큰 인덱스). 굴절형(-s, -ed, -ing)도 인정한다 */
function findCloze(word: string, sentence: string): number {
  const tokens = tokenize(sentence);
  const target = word.toLowerCase();
  const head = target.split(' ')[0];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === target || t === head) return i;
    if (t.startsWith(head) && head.length >= 3) return i; // runs, running, played
    // climb → climbs, carry → carries, swim → swims
    if (head.endsWith('y') && t.startsWith(head.slice(0, -1) + 'i')) return i;
  }
  return -1;
}

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

/* ── 로드 ── */

const files = readdirSync(SEED_DIR)
  .filter((f) => f.endsWith('.tsv'))
  .sort();
const seeds: Seed[] = files.flatMap((f) => parseSeedFile(join(SEED_DIR, f), f));

const errors: string[] = [];
const warnings: string[] = [];
const notes: string[] = [];
const err = (s: Seed, msg: string) => errors.push(`${s.origin} [${s.word}] ${msg}`);
const warn = (s: Seed, msg: string) => warnings.push(`${s.origin} [${s.word}] ${msg}`);

/* ── 규칙 1: 표제어 중복 ── */
const byWord = new Map<string, Seed>();
for (const s of seeds) {
  const key = s.word.toLowerCase();
  const dup = byWord.get(key);
  if (dup) err(s, `표제어 중복 (${dup.origin} 과 같다)`);
  else byWord.set(key, s);
}

/* ── 규칙 2: 필수 필드 ── */
for (const s of seeds) {
  if (!s.word) err(s, '표제어 없음');
  if (!Number.isInteger(s.level) || s.level < 1 || s.level > 10) err(s, `level 이 이상하다: ${s.level}`);
  if (!s.grade) err(s, 'grade 없음');
  if (!s.meaning) err(s, '뜻 없음');
  if (!s.example) err(s, '예문 없음');
  if (!s.exampleKo) err(s, '예문 번역 없음');
  // tags 는 좋은 오답을 뽑는 1순위 기준이다. 없으면 오답이 무작위가 된다
  if (s.tags.length === 0) err(s, 'tags 없음 — 오답 품질의 1순위 기준이라 필수다');
}

/* ── 규칙 3: 뜻 충돌 (가장 중요) ──
   표기가 완전히 같은 뜻이 둘 있으면 KO→EN 문제의 정답이 두 개가 된다.
   동의어로 선언했으면 통과시키되, 서로의 오답 후보에서 제외한다. */
const byMeaning = new Map<string, Seed[]>();
for (const s of seeds) {
  for (const m of [s.meaning, ...s.meaningAlt]) {
    const key = normMeaning(m);
    const list = byMeaning.get(key) ?? [];
    list.push(s);
    byMeaning.set(key, list);
  }
}
const declaredSynonym = (a: Seed, b: Seed) =>
  a.synonyms.some((w) => w.toLowerCase() === b.word.toLowerCase());

for (const [meaning, list] of byMeaning) {
  const uniq = [...new Set(list)];
  if (uniq.length < 2) continue;
  for (let i = 0; i < uniq.length; i++) {
    for (let j = i + 1; j < uniq.length; j++) {
      const [a, b] = [uniq[i], uniq[j]];
      if (declaredSynonym(a, b) && declaredSynonym(b, a)) continue;
      errors.push(
        `뜻 충돌: '${a.word}'(${a.origin}) 와 '${b.word}'(${b.origin}) 가 모두 "${meaning}" 이다.\n` +
          `    → 정답이 둘인 문제가 만들어진다. 뜻을 구분해 쓰거나(예: 눈(신체)/눈(날씨)) ` +
          `synonyms 컬럼에 서로를 선언할 것.`,
      );
    }
  }
}

/* 동음이의(한국어 표기가 같고 괄호로만 구분) — 에러는 아니지만 기록해 둔다 */
const byBase = new Map<string, Seed[]>();
for (const s of seeds) {
  const key = baseMeaning(s.meaning);
  if (key === normMeaning(s.meaning)) continue;
  const list = byBase.get(key) ?? [];
  list.push(s);
  byBase.set(key, list);
}
for (const [base, list] of byBase) {
  if (list.length >= 2) {
    notes.push(`동음이의 처리됨: "${base}" → ${list.map((s) => `${s.word}(${s.meaning})`).join(' / ')}`);
  }
}

/* ── 규칙 4: synonyms 양방향 선언 · 대상 존재 ── */
for (const s of seeds) {
  for (const syn of s.synonyms) {
    const target = byWord.get(syn.toLowerCase());
    if (!target) {
      err(s, `synonyms 에 없는 단어를 적었다: '${syn}' — 단어를 추가하거나 선언을 지울 것`);
      continue;
    }
    if (!declaredSynonym(target, s)) {
      err(s, `synonyms 는 양방향이어야 한다: '${syn}' 쪽에도 '${s.word}' 를 적을 것`);
    }
  }
}

/* ── 규칙 5: 예문에 표제어 포함 → clozeIndex ── */
const clozeIndex = new Map<string, number>();
for (const s of seeds) {
  const idx = findCloze(s.word, s.example);
  if (idx < 0) err(s, `예문에 표제어가 없다: "${s.example}"`);
  clozeIndex.set(s.word, idx);
}

/* ── 규칙 6: 예문 길이 ── */
for (const s of seeds) {
  const limit = s.grade.startsWith('middle') ? MAX_EXAMPLE_WORDS.middle : MAX_EXAMPLE_WORDS.elementary;
  const count = tokenize(s.example).length;
  if (count > limit) err(s, `예문이 너무 길다: ${count}단어 (상한 ${limit}) "${s.example}"`);
}

/* ── 규칙 7: 예문 난이도 — DB 밖 내용어가 많으면 예문이 표제어보다 어렵다 ── */
for (const s of seeds) {
  const unknown = tokenize(s.example).filter(
    (t) => !FUNCTION_WORDS.has(t) && !byWord.has(t) && findCloze(s.word, t) < 0,
  );
  // 굴절형 때문에 DB 에 있는 단어가 unknown 으로 잡히는 경우를 걸러낸다
  const real = unknown.filter((t) => ![...byWord.keys()].some((w) => t.startsWith(w) && w.length >= 3));
  if (real.length >= 3) {
    warn(s, `예문에 DB 밖 단어가 ${real.length}개: ${real.join(', ')} — 더 쉬운 예문을 권장`);
  }
}

/* ── 규칙 8: 품사 ↔ 한국어 뜻 형식 ──
   형태소 분석기 없이 할 수 있는 확실한 부분만 검사한다: 동사는 '~다'로 끝나고,
   명사·형용사·부사는 그렇지 않다. (형용사의 어미는 한/은/운/는/린… 으로 너무 다양해
   화이트리스트를 만들면 오탐이 더 많아진다)

   단, **'다'로 끝나는 명사가 실제로 있다** — 바다·소다처럼. L4 배치에서 `ocean`(바다)이
   이 규칙에 걸렸다. 형태소 분석기를 넣기 전까지는 예외 목록으로 둔다. */
const NOUN_ENDING_IN_DA = new Set(['바다', '소다', '사이다', '고구마다']);
for (const s of seeds) {
  const endsWithDa = /다$/.test(s.meaning);
  const isVerb = s.pos === 'verb' || s.pos === 'verb_phrase';
  if (isVerb && !endsWithDa) err(s, `동사인데 뜻이 '~다'로 끝나지 않는다: "${s.meaning}"`);
  if (!isVerb && endsWithDa && !NOUN_ENDING_IN_DA.has(s.meaning)) {
    err(
      s,
      `${s.pos} 인데 뜻이 '~다'로 끝난다: "${s.meaning}"` +
        ` — 실제로 '다'로 끝나는 명사라면 build-words.ts 의 NOUN_ENDING_IN_DA 에 추가할 것`,
    );
  }
}

/* ── 규칙 9: 금칙어 ── */
for (const s of seeds) {
  const hay = `${s.word} ${s.example}`.toLowerCase();
  for (const banned of BANNED) {
    if (new RegExp(`\\b${banned}\\b`).test(hay)) err(s, `아동 부적절 어휘 '${banned}' 포함`);
  }
}

/* ── 규칙 10: image 는 실제 3D 노드여야 한다 (에셋 파이프라인과 교차 검증) ── */
let foodNodes: Set<string> | null = null;
if (existsSync(FOOD_MANIFEST)) {
  const manifest = JSON.parse(readFileSync(FOOD_MANIFEST, 'utf8')) as {
    bundles: Array<{ name: string; nodes: string[] }>;
  };
  const food = manifest.bundles.find((b) => b.name === 'food');
  if (food) foodNodes = new Set(food.nodes);
}
for (const s of seeds) {
  if (!s.image) continue;
  if (!foodNodes) {
    warnings.push(`${s.origin} [${s.word}] image 검증 생략 — public/models/manifest.json 이 없다 (npm run assets)`);
    break;
  }
  if (!foodNodes.has(s.image)) {
    err(s, `image '${s.image}' 가 food.glb 에 없다 — asset-manifest.json 에 추가하거나 이름을 고칠 것`);
  }
}

/* ── 오답 후보 프리컴퓨트 ──
   PRD 6장 우선순위: 의미 유사(tag) → 철자 유사 → 같은 품사 → 같은 난이도 → 같은 학년.
   런타임에 계산하지 않는 이유: (1) 매 문제마다 전체 DB 를 훑을 이유가 없고,
   (2) 빌드 시점에 계산해 두면 **품질을 검사할 수 있다.** */
function scoreDistractor(a: Seed, b: Seed): number {
  let score = 0;
  const sharedTags = a.tags.filter((t) => b.tags.includes(t)).length;
  if (sharedTags > 0) score += 6 + sharedTags; // 같은 범주 = 가장 그럴듯한 오답
  if (a.pos === b.pos) score += 3;
  const levelGap = Math.abs(a.level - b.level);
  if (levelGap === 0) score += 2;
  else if (levelGap === 1) score += 1;
  else score -= levelGap;
  if (a.grade === b.grade) score += 1;
  if (a.freq === b.freq) score += 1;

  // 철자 유사 — 같은 첫 글자 / 편집 거리가 짧은 단어는 실제로 잘 헷갈린다
  if (a.word[0] === b.word[0]) score += 1;
  const dist = levenshtein(a.word.toLowerCase(), b.word.toLowerCase());
  if (dist <= 3) score += 2;

  // 보기 길이를 비슷하게 — 길이가 튀면 "제일 긴 보기가 정답"이라는 편법이 생긴다
  if (Math.abs(a.meaning.length - b.meaning.length) <= 2) score += 1;
  return score;
}

const excluded = (a: Seed, b: Seed): boolean => {
  if (a === b) return true;
  // 동의어로 선언된 쌍은 절대 서로의 오답이 되면 안 된다 (정답이 둘이 된다)
  if (declaredSynonym(a, b) || declaredSynonym(b, a)) return true;
  // 뜻 표기가 겹치는 경우도 제외 (meaningAlt 포함)
  const aMeanings = new Set([a.meaning, ...a.meaningAlt].map(normMeaning));
  return [b.meaning, ...b.meaningAlt].some((m) => aMeanings.has(normMeaning(m)));
};

const pools = new Map<string, string[]>();
for (const s of seeds) {
  const scored = seeds
    .filter((other) => !excluded(s, other))
    .map((other) => ({ other, score: scoreDistractor(s, other) }))
    .sort((x, y) => y.score - x.score);

  /* 뜻 표기가 같은 후보를 둘 이상 담지 않는다.
     `small`(작은)과 `little`(작은)이 같은 후보 목록에 있으면 한 문제에 "작은"이
     두 번 나올 수 있고, 그렇지 않더라도 실효 후보 수가 줄어든다. */
  const takenMeanings = new Set<string>();
  const ranked = scored
    .filter(({ other }) => {
      const key = normMeaning(other.meaning);
      if (takenMeanings.has(key)) return false;
      takenMeanings.add(key);
      return true;
    })
    .slice(0, POOL_SIZE);

  if (ranked.length < MIN_DISTRACTORS) {
    err(s, `오답 후보가 ${ranked.length}개뿐 — 4지선다를 만들 수 없다 (최소 ${MIN_DISTRACTORS})`);
  }
  const sameTag = ranked.filter((r) => r.other.tags.some((t) => s.tags.includes(t))).length;
  if (sameTag < 3) {
    warn(s, `같은 범주(tag) 오답이 ${sameTag}개뿐 — 같은 tag 단어를 더 추가하면 문제가 좋아진다`);
  }
  pools.set(s.word, ranked.map((r) => r.other.word));
}

/* ── 실패 시 중단 ── */
if (errors.length) {
  console.error(`\n❌ 검증 실패 — 에러 ${errors.length}건\n`);
  for (const e of errors) console.error('  ' + e);
  if (warnings.length) {
    console.error(`\n경고 ${warnings.length}건:`);
    for (const w of warnings.slice(0, 20)) console.error('  ' + w);
  }
  console.error('\n산출물을 쓰지 않았다. 시드 데이터를 고칠 것.\n');
  process.exit(1);
}

/* ── 산출 ── */
const FREQ_VALUE: Record<Freq, number> = { high: 0.9, mid: 0.6, low: 0.3 };
const FREQ_DIFFICULTY: Record<Freq, number> = { high: 0, mid: 0.06, low: 0.12 };

const words: Word[] = seeds.map((s, i) => ({
  id: `word_${String(i + 1).padStart(6, '0')}`,
  word: s.word,
  meaning: s.meaning,
  meaningAlt: s.meaningAlt,
  partOfSpeech: s.pos,
  level: s.level,
  grade: s.grade,
  /*
   * 파생값이다 — 코퍼스 실측이 아니라 level·빈도 밴드에서 계산한 값.
   *
   * 하한을 두지 않는다. 처음에 0.05 를 하한으로 걸었더니 **가장 쉬운 단어가 레벨 1.45** 가
   * 되어, 이제 시작하는 초3 학생(theta≈2)에게 정답률 상한이 63% 로 묶였다.
   * Level 1 고빈도 단어(cat, dog, apple …)는 이 커리큘럼의 바닥이므로 난이도 0 이 맞다.
   */
  difficulty: Math.min(0.98, Math.max(0, +(((s.level - 1) / 9) * 0.8 + FREQ_DIFFICULTY[s.freq]).toFixed(3))),
  frequency: FREQ_VALUE[s.freq],
  exampleSentence: s.example,
  exampleTranslation: s.exampleKo,
  clozeIndex: clozeIndex.get(s.word) ?? -1,
  synonyms: s.synonyms,
  antonyms: [],
  tags: s.tags,
  isPhrase: s.word.includes(' '),
  distractorPool: pools.get(s.word) ?? [],
  imageAsset: s.image,
}));

mkdirSync(OUT_DIR, { recursive: true });
const levels = [...new Set(words.map((w) => w.level))].sort((a, b) => a - b);
for (const level of levels) {
  const list = words.filter((w) => w.level === level);
  writeFileSync(join(OUT_DIR, `level-${level}.json`), JSON.stringify(list, null, 1) + '\n');
}
writeFileSync(
  join(OUT_DIR, 'manifest.json'),
  JSON.stringify(
    {
      generated: 'npm run words',
      total: words.length,
      levels: levels.map((level) => ({
        level,
        count: words.filter((w) => w.level === level).length,
        file: `level-${level}.json`,
      })),
    },
    null,
    2,
  ) + '\n',
);

/* ── 리포트 ── */
console.log(`\n✅ 검증 통과 — ${words.length}개 단어\n`);
const pad = (s: unknown, n: number) => String(s).padEnd(n);
console.log(pad('레벨', 6), pad('단어', 6), pad('명사', 6), pad('동사', 6), pad('형용사', 8), pad('그림', 6));
console.log('-'.repeat(46));
for (const level of levels) {
  const list = words.filter((w) => w.level === level);
  console.log(
    pad(level, 6),
    pad(list.length, 6),
    pad(list.filter((w) => w.partOfSpeech === 'noun').length, 6),
    pad(list.filter((w) => w.partOfSpeech === 'verb').length, 6),
    pad(list.filter((w) => w.partOfSpeech === 'adjective').length, 8),
    pad(list.filter((w) => w.imageAsset).length, 6),
  );
}

const tagCounts = new Map<string, number>();
for (const w of words) for (const t of w.tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
const thin = [...tagCounts.entries()].filter(([, n]) => n < 4).sort((a, b) => a[1] - b[1]);

console.log(`\n의미 범주 ${tagCounts.size}종 · 오답 후보 평균 ${(
  words.reduce((a, w) => a + w.distractorPool.length, 0) / words.length
).toFixed(1)}개`);
if (thin.length) {
  console.log(`범주가 얇음(4개 미만): ${thin.map(([t, n]) => `${t}(${n})`).join(', ')}`);
}
for (const n of notes) console.log(`· ${n}`);
if (warnings.length) {
  console.log(`\n경고 ${warnings.length}건 (빌드는 통과):`);
  for (const w of warnings.slice(0, 12)) console.log('  ' + w);
  if (warnings.length > 12) console.log(`  … 그 외 ${warnings.length - 12}건`);
}
console.log('');
