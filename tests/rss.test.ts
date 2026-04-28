import { describe, expect, it } from "vitest";
import {
  extractMetadata,
  parseFeed,
  validateFeedItemAgainstPage,
} from "../packages/crawler-core/src";

describe("RSS parsing and page validation", () => {
  it("parses feed items and verifies matching canonical page metadata", () => {
    const items = parseFeed(`
      <rss><channel><title>Example</title><item>
        <title>Central bank weighs slower rate path</title>
        <link>https://example.com/story?utm_source=rss</link>
        <pubDate>Wed, 22 Apr 2026 06:00:00 GMT</pubDate>
      </item></channel></rss>
    `);

    const metadata = extractMetadata(
      `<html lang="en"><head>
        <link rel="canonical" href="https://example.com/story">
        <meta property="og:title" content="Central bank weighs slower rate path after data">
        <meta property="article:published_time" content="2026-04-22T06:05:00Z">
      </head></html>`,
      "https://example.com/story?utm_source=rss",
    );

    expect(items).toHaveLength(1);
    expect(validateFeedItemAgainstPage(items[0], metadata)).toBe(
      "rss_verified",
    );
  });

  it("decodes HTML entities in RSS titles before validation", () => {
    const items = parseFeed(`
      <rss><channel><title>ZDFheute</title><item>
        <title>Wie die Gr&#252;nen von der SPD-Schw&#228;che profitieren wollen</title>
        <link>https://example.com/story</link>
        <pubDate>Tue, 28 Apr 2026 09:29:00 +0200</pubDate>
      </item></channel></rss>
    `);

    const metadata = extractMetadata(
      `<html lang="de"><head>
        <link rel="canonical" href="https://example.com/story">
        <meta property="og:title" content="Wie die Grünen von der SPD-Schwäche profitieren wollen">
        <meta property="article:published_time" content="2026-04-28T07:29:47.762Z">
      </head></html>`,
      "https://example.com/story",
    );

    expect(items[0]?.title).toBe(
      "Wie die Grünen von der SPD-Schwäche profitieren wollen",
    );
    expect(validateFeedItemAgainstPage(items[0], metadata)).toBe(
      "rss_verified",
    );
  });
});
