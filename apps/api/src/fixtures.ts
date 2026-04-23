import type { ArticleWithPublisher, Story } from "@news/types";

export const demoStory = {
  id: "00000000-0000-4000-8000-000000000001",
  title: "Central bank signals slower rate changes after inflation data",
  topicTags: ["economy", "central-banks"],
  firstSeenAt: "2026-04-22T06:15:00.000Z",
  lastSeenAt: "2026-04-22T08:30:00.000Z",
  summary: {
    neutralSummary:
      "Several outlets report that central bank officials are likely to slow the pace of rate changes after the latest inflation readings. Coverage differs on whether the data points to a durable trend or a temporary pause.",
    agreed: [
      "Officials referenced recent inflation data.",
      "Markets are watching the next policy meeting.",
    ],
    differs: [
      "Some outlets frame the shift as caution; others frame it as relief for borrowers.",
    ],
    contestedOrUnverified: [
      "The exact timing of any rate move remains unconfirmed.",
    ],
    confidence: 0.86,
    lastUpdatedAt: "2026-04-22T08:30:00.000Z",
  },
  coverage: {
    byCountry: { US: 12, DE: 4, FR: 3, IN: 2 },
    byLanguage: { en: 13, de: 4, fr: 3, hi: 1 },
    byTaxonomy: { insufficient_context: 9, center: 5, unrated: 7 },
    byOwnership: { public: 2, private: 14, unknown: 5 },
    byReliability: { high: 8, medium: 10, insufficient_context: 3 },
  },
} satisfies Story;

export const demoArticles = [
  {
    id: "00000000-0000-4000-8000-000000000101",
    sourceId: "00000000-0000-4000-8000-000000000201",
    publisher: "Example Ledger",
    country: "US",
    canonicalUrl: "https://example.com/rates-inflation-policy",
    title: "Central bank weighs slower rate path after inflation report",
    snippet:
      "Officials pointed to softer data while warning that one month does not establish a trend.",
    author: "Markets desk",
    publishedAt: "2026-04-22T06:15:00.000Z",
    language: "en",
    articleType: "news",
    paywalled: false,
    crawlStatus: "rss_verified",
  },
  {
    id: "00000000-0000-4000-8000-000000000102",
    sourceId: "00000000-0000-4000-8000-000000000202",
    publisher: "Finanz Morgen",
    country: "DE",
    canonicalUrl: "https://example.de/notenbank-inflation-zinsen",
    title: "Notenbank deutet vorsichtigeren Kurs an",
    snippet:
      "Die neue Inflationszahl dämpft Erwartungen an schnelle weitere Zinsschritte.",
    author: null,
    publishedAt: "2026-04-22T07:05:00.000Z",
    language: "de",
    articleType: "news",
    paywalled: true,
    crawlStatus: "rss_verified",
  },
] satisfies ArticleWithPublisher[];
