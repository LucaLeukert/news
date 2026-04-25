import { readStopwords } from "./resources";
import type { WordStats } from "./types";
import { normalizeLanguageCode } from "./languages";

const contractionSeparators = /[-'`ʹʻʼʽʾʿˈˊ‘’‛′‵Ꞌꞌ]+/g;
const punctuation = /[\p{P}\p{S}]+/gu;

const defaultTokenizer = (text: string) =>
  text
    .replace(punctuation, " ")
    .replace(contractionSeparators, " ")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

const segmentTokenizer = (language: string, text: string) => {
  try {
    const segmenter = new Intl.Segmenter(language, { granularity: "word" });
    return Array.from(segmenter.segment(text))
      .map((part) => part.segment.trim().toLowerCase())
      .filter((part) => part && /\p{Letter}|\p{Number}/u.test(part));
  } catch {
    return defaultTokenizer(text);
  }
};

export class StopWords {
  readonly language: string;
  readonly stopWords: ReadonlySet<string>;

  constructor(language = "en") {
    this.language = normalizeLanguageCode(language);
    this.stopWords = readStopwords(this.language);
  }

  tokenizer(text: string) {
    if (["zh", "ja", "ko", "th"].includes(this.language)) {
      return segmentTokenizer(this.language, text);
    }
    return defaultTokenizer(text);
  }

  getStopwordCount(content: string): WordStats {
    const tokens = this.tokenizer(content);
    const stopWords = tokens.filter((token) => this.stopWords.has(token));
    return {
      stopWordCount: stopWords.length,
      wordCount: tokens.length,
      stopWords,
    };
  }
}

export const keywords = (
  text: string,
  stopwords: StopWords,
  maxKeywords?: number,
) => {
  if (!text) {
    return {} as Record<string, number>;
  }
  const tokens = stopwords
    .tokenizer(text)
    .filter((token) => !stopwords.stopWords.has(token));
  const totalWords = Math.max(tokens.length, 1);
  const counts = new Map<string, number>();
  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return Object.fromEntries(
    Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, maxKeywords)
      .map(([token, count]) => [token, (count * 1.5) / totalWords + 1]),
  );
};

const splitSentences = (text: string) => {
  try {
    const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });
    return Array.from(segmenter.segment(text))
      .map((entry) => entry.segment.replace(/\s+/g, " ").trim())
      .filter((entry) => entry.length > 10);
  } catch {
    return text
      .split(/(?<=[.!?])\s+/)
      .map((entry) => entry.replace(/\s+/g, " ").trim())
      .filter((entry) => entry.length > 10);
  }
};

const titleScore = (
  titleTokens: ReadonlyArray<string>,
  sentenceTokens: ReadonlyArray<string>,
  stopwords: StopWords,
) => {
  const filteredTitle = titleTokens.filter(
    (token) => !stopwords.stopWords.has(token),
  );
  if (filteredTitle.length === 0) {
    return 0;
  }
  const intersection = sentenceTokens.filter((token) =>
    filteredTitle.includes(token),
  );
  return intersection.length / filteredTitle.length;
};

const sbs = (
  words: ReadonlyArray<string>,
  keywordScores: Record<string, number>,
) => {
  if (words.length === 0) {
    return 0;
  }
  const score = words.reduce(
    (sum, word) => sum + (keywordScores[word] ?? 0),
    0,
  );
  return score / words.length / 10;
};

const dbs = (
  words: ReadonlyArray<string>,
  keywordScores: Record<string, number>,
) => {
  const keys = words
    .map((word, index) => [index, keywordScores[word] ?? 0, word] as const)
    .filter((entry) => entry[1] > 0);
  if (keys.length === 0) {
    return 0;
  }
  let sum = 0;
  const intersection = new Set<string>();
  for (let index = 0; index < keys.length - 1; index += 1) {
    const first = keys[index];
    const second = keys[index + 1];
    if (!first || !second) continue;
    const distance = second[0] - first[0];
    sum += (first[1] * second[1]) / (distance ** 2);
    intersection.add(first[2]);
  }
  const last = keys.at(-1);
  if (last) {
    intersection.add(last[2]);
  }
  const k = intersection.size + 1;
  return (1 / (k * (k + 1))) * sum;
};

const sentencePositionScore = (index: number, size: number) => {
  const normalized = index / size;
  const ranges: ReadonlyArray<readonly [number, number]> = [
    [1, 0],
    [0.9, 0.15],
    [0.8, 0.04],
    [0.7, 0.04],
    [0.6, 0.06],
    [0.5, 0.04],
    [0.4, 0.05],
    [0.3, 0.08],
    [0.2, 0.14],
    [0.1, 0.23],
    [0, 0.17],
  ];
  for (const [boundary, score] of ranges) {
    if (normalized > boundary) {
      return score;
    }
  }
  return 0;
};

export const summarize = (
  title: string,
  text: string,
  stopwords: StopWords,
  maxSentences = 5,
) => {
  if (!title || !text || maxSentences <= 0) {
    return [] as string[];
  }
  const sentences = splitSentences(text);
  const titleTokens = stopwords.tokenizer(title);
  const keywordScores = keywords(text, stopwords, 10);
  return sentences
    .map((sentence, index) => {
      const tokens = stopwords.tokenizer(sentence);
      const frequency = ((sbs(tokens, keywordScores) + dbs(tokens, keywordScores)) / 2) * 10;
      const score =
        (titleScore(titleTokens, tokens, stopwords) * 1.5 +
          frequency * 2 +
          (1 - Math.abs(20 - tokens.length) / 20) +
          sentencePositionScore(index + 1, sentences.length)) /
        4;
      return { index, sentence, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, maxSentences)
    .sort((a, b) => a.index - b.index)
    .map((entry) => entry.sentence);
};
