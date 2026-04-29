import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));
const resourcesDir = join(currentDir, "..", "resources");
const stopwordsDir = join(resourcesDir, "text");
const miscDir = join(resourcesDir, "misc");

export const readStopwords = (language: string) =>
  new Set(
    readFileSync(join(stopwordsDir, `stopwords-${language}.txt`), "utf8")
      .split("\n")
      .map((value) => value.trim())
      .filter(Boolean),
  );

export const listLanguages = () =>
  readdirSync(stopwordsDir)
    .map((name) => /^stopwords-(.+)\.txt$/.exec(name)?.[1] ?? null)
    .filter((value): value is string => value !== null)
    .sort();

export const popularUrls = () =>
  readFileSync(join(miscDir, "popular_sources.txt"), "utf8")
    .split("\n")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => `http://${value}`);
