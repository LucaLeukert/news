import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import { describe, expect, test } from "vitest";
import { Article } from "../src/article";
import { CrawlerHttpLive } from "../src/transport";

const currentDir = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(currentDir, "fixtures");

const readFixture = (kind: string, name: string) =>
  readFileSync(join(fixtureDir, kind, name), "utf8");

describe("Article", () => {
  test("parses cnn fixture close to upstream output", async () => {
    const html = readFixture("html", "cnn_001.html");
    const metadata = JSON.parse(
      readFixture("metadata", "cnn_001.json"),
    ) as Record<string, unknown>;
    const article = new Article(String(metadata.url), "", "", "", undefined, {
      fetchImages: false,
    });

    await Effect.runPromise(
      article
        .download({ inputHtml: html })
        .pipe(Effect.flatMap(() => article.parse()), Effect.provide(CrawlerHttpLive)),
    );

    expect(article.title).toContain("nonstop sparring match");
    expect(article.metaLang).toBe(metadata.meta_lang);
    expect(article.authors).toEqual(metadata.authors);
    expect(article.topImage).toBe(metadata.top_image);
    expect(article.text).toContain("Justice Samuel Alito is the tip of the spear");
  });

  test("runs nlp on fixture content", async () => {
    const html = readFixture("html", "wired_001.html");
    const metadata = JSON.parse(
      readFixture("metadata", "wired_001.json"),
    ) as Record<string, unknown>;
    const article = new Article(String(metadata.url), "", "", "", undefined, {
      fetchImages: false,
    });

    await Effect.runPromise(
      article
        .download({ inputHtml: html })
        .pipe(
          Effect.flatMap(() => article.parse()),
          Effect.flatMap(() => article.nlp()),
          Effect.provide(CrawlerHttpLive),
        ),
    );

    expect(article.keywords.length).toBeGreaterThan(5);
    expect(article.summary.length).toBeGreaterThan(0);
  });
});
