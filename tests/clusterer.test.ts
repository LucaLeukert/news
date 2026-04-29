import { describe, expect, it } from "vitest";
import {
  clusterArticles,
  scoreSameStory,
  semanticPairKey,
} from "../services/clusterer/src";

describe("story clustering score", () => {
  it("scores related event candidates higher than unrelated ones", () => {
    const a = {
      id: "a",
      canonicalUrl: "https://a.test/story",
      title: "Central bank weighs slower rate path after inflation data",
      entityKeys: ["central-bank", "inflation"],
      focusTokens: ["central", "bank", "inflation"],
      publishedAt: "2026-04-22T06:00:00Z",
    };
    const b = {
      id: "b",
      canonicalUrl: "https://b.test/story",
      title: "Inflation data pushes central bank toward slower rate moves",
      entityKeys: ["central-bank", "inflation"],
      focusTokens: ["central", "bank", "inflation"],
      publishedAt: "2026-04-22T08:00:00Z",
    };
    const c = {
      id: "c",
      canonicalUrl: "https://c.test/story",
      title: "Football club signs new goalkeeper",
      entityKeys: ["football-club"],
      focusTokens: ["football", "goalkeeper"],
      publishedAt: "2026-04-22T08:00:00Z",
    };

    expect(scoreSameStory(a, b)).toBeGreaterThan(scoreSameStory(a, c));
  });
});

describe("clusterArticles", () => {
  const article = (
    id: string,
    title: string,
    overrides: Partial<Parameters<typeof clusterArticles>[0][number]> = {},
  ): Parameters<typeof clusterArticles>[0][number] => ({
    id,
    sourceId: "00000000-0000-4000-8000-000000000010",
    canonicalUrl: `https://publisher.test/${id}`,
    title,
    snippet: "Short metadata-only snippet.",
    author: null,
    publishedAt: "2026-04-22T08:00:00.000Z",
    language: "en",
    articleType: "news",
    paywalled: false,
    crawlStatus: "rss_verified",
    publisher: "Publisher",
    country: "US",
    ...overrides,
  });

  it("groups related verified articles and computes coverage distribution", () => {
    const clusters = clusterArticles([
      article(
        "00000000-0000-4000-8000-000000000101",
        "Central bank weighs slower rate path after inflation data",
        { publisher: "US Publisher", country: "US" },
      ),
      article(
        "00000000-0000-4000-8000-000000000102",
        "Inflation data pushes central bank toward slower rate moves",
        {
          sourceId: "00000000-0000-4000-8000-000000000011",
          publisher: "DE Publisher",
          country: "DE",
          language: "de",
        },
      ),
      article(
        "00000000-0000-4000-8000-000000000103",
        "Football club signs new goalkeeper",
        { country: "GB" },
      ),
    ]);

    expect(clusters).toHaveLength(2);
    expect(clusters[0].articles.map((item) => item.id)).toEqual([
      "00000000-0000-4000-8000-000000000101",
      "00000000-0000-4000-8000-000000000102",
    ]);
    expect(clusters[0].story.coverage.byCountry).toEqual({ US: 1, DE: 1 });
    expect(clusters[0].story.coverage.byLanguage).toEqual({ en: 1, de: 1 });
    expect(clusters[0].story.summary).toBeNull();
  });

  it("does not cluster mismatched or failed crawl results", () => {
    const clusters = clusterArticles([
      article(
        "00000000-0000-4000-8000-000000000201",
        "Central bank weighs slower rate path after inflation data",
      ),
      article(
        "00000000-0000-4000-8000-000000000202",
        "Central bank weighs slower rate path after inflation data",
        { crawlStatus: "rss_mismatch_title" },
      ),
    ]);

    expect(clusters).toHaveLength(1);
    expect(clusters[0].articles).toHaveLength(1);
    expect(clusters[0].articles[0].id).toBe(
      "00000000-0000-4000-8000-000000000201",
    );
  });

  it("uses AI-derived entity keys and fingerprints to cluster rewritten headlines", () => {
    const clusters = clusterArticles([
      article(
        "00000000-0000-4000-8000-000000000301",
        "Powell faces new pressure after inflation surprise",
        {
          aiEntityKeys: ["jerome-powell", "federal-reserve"],
          semanticCuePhrases: ["fed-rate-path"],
          semanticFingerprint: "fed-rates-inflation-pressure",
        },
      ),
      article(
        "00000000-0000-4000-8000-000000000302",
        "Fed chair confronted as price data rattles policymakers",
        {
          aiEntityKeys: ["jerome-powell", "federal-reserve"],
          semanticCuePhrases: ["fed-rate-path"],
          semanticFingerprint: "fed-rates-inflation-pressure",
        },
      ),
    ]);

    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.articles).toHaveLength(2);
  });

  it("uses semantic pair scores to merge low-overlap rewrites", () => {
    const firstId = "00000000-0000-4000-8000-000000000401";
    const secondId = "00000000-0000-4000-8000-000000000402";
    const clusters = clusterArticles(
      [
        article(firstId, "King Charles III expected to address US Congress", {
          semanticFingerprint: "Charles III state visit to Washington",
        }),
        article(
          secondId,
          "Trump welcomes British monarch during White House visit",
          {
            semanticFingerprint:
              "British king meets US president in Washington",
          },
        ),
      ],
      {
        semanticPairScores: new Map([
          [semanticPairKey(firstId, secondId), 0.86],
        ]),
      },
    );

    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.articles).toHaveLength(2);
  });

  it("does not cluster broad market/oil coverage that only overlaps topically", () => {
    const firstId = "00000000-0000-4000-8000-000000000501";
    const secondId = "00000000-0000-4000-8000-000000000502";
    const thirdId = "00000000-0000-4000-8000-000000000503";

    const clusters = clusterArticles(
      [
        article(firstId, "Rohöl kostet schon wieder mehr als 110 Dollar", {
          language: "de",
          semanticCuePhrases: ["iran krieg oelpreis"],
          aiEntityKeys: ["iran", "krieg"],
          semanticFingerprint: "rohöl preis steigt auf 110 dollar",
        }),
        article(
          secondId,
          "Ölkonzern BP profitiert stark von Ölpreisschock durch Iran-Krieg",
          {
            language: "de",
            semanticCuePhrases: ["bp gewinn iran krieg"],
            aiEntityKeys: ["bp", "iran", "krieg"],
            semanticFingerprint: "bp verdoppelt gewinn durch hohe ölpreise",
          },
        ),
        article(thirdId, "Marktbericht: Aktien- und Ölmärkte ernüchtert", {
          language: "de",
          semanticCuePhrases: ["iran krieg dax oelmarkt"],
          aiEntityKeys: ["iran", "krieg", "dax"],
          semanticFingerprint: "dax schwach wegen teurerem oel",
        }),
      ],
      {
        semanticPairScores: new Map([
          [semanticPairKey(firstId, secondId), 0.74],
          [semanticPairKey(firstId, thirdId), 0.71],
          [semanticPairKey(secondId, thirdId), 0.69],
        ]),
      },
    );

    expect(clusters).toHaveLength(3);
  });
});
