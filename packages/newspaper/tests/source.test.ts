import { Effect } from "effect";
import { describe, expect, test } from "vitest";
import { Source } from "../src/source";
import { CrawlerHttpLive } from "../src/transport";

describe("Source", () => {
  test("builds tagesschau homepage into categories and candidate articles", async () => {
    const source = new Source("https://www.tagesschau.de", "", undefined, {
      fetchImages: false,
      numberThreads: 2,
    });

    await Effect.runPromise(
      source
        .build({ onlyHomepage: true })
        .pipe(Effect.provide(CrawlerHttpLive)),
    );

    expect(source.categoryUrls().length).toBe(1);
    expect(source.articleUrls().length).toBeGreaterThan(0);
  });
});
