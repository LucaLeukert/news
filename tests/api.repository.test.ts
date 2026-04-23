import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  FixtureNewsRepositoryLive,
  NewsRepository,
  makeFixtureRepository,
} from "../apps/api/src/repository";

describe("fixture news repository", () => {
  it("filters stories by coverage country and language", () => {
    const repository = makeFixtureRepository();

    expect(
      Effect.runSync(repository.listStories({ country: "DE" })),
    ).toHaveLength(1);
    expect(
      Effect.runSync(repository.listStories({ country: "JP" })),
    ).toHaveLength(0);
    expect(
      Effect.runSync(repository.listStories({ language: "de" })),
    ).toHaveLength(1);
  });

  it("searches story and article metadata without article bodies", () => {
    const repository = makeFixtureRepository();
    const results = Effect.runSync(repository.search("inflation"));

    expect(results.stories).toHaveLength(1);
    expect(results.articles).toHaveLength(2);
    expect(results.articles[0]?.snippet).toContain("softer data");
  });

  it("resolves known article URLs without queueing a crawl", () => {
    const repository = makeFixtureRepository();
    const resolved = Effect.runSync(
      repository.resolveUrl(
        "https://www.example.com/rates-inflation-policy?utm_source=social#frag",
      ),
    );

    expect(resolved).toEqual({
      storyId: "00000000-0000-4000-8000-000000000001",
      articleId: "00000000-0000-4000-8000-000000000101",
    });
  });

  it("is available through an Effect layer", async () => {
    const stories = await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* NewsRepository;
        return yield* repository.listStories({ country: "US" });
      }).pipe(Effect.provide(FixtureNewsRepositoryLive)),
    );

    expect(stories).toHaveLength(1);
  });
});
