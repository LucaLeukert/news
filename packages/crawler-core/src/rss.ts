import { DateTime } from "effect";
import { XMLParser } from "fast-xml-parser";

export type FeedItem = {
  title: string;
  url: string;
  publishedAt: string | null;
  sourceName: string | null;
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
});

function asArray<T>(value: T | T[] | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

export function parseFeed(xml: string): FeedItem[] {
  const doc = parser.parse(xml) as any;
  const channel = doc.rss?.channel;
  if (channel) {
    return asArray(channel.item).flatMap((item: any) => {
      const url = item.link ?? item.guid?.["#text"] ?? item.guid;
      if (!item.title || !url) return [];
      return [
        {
          title: String(item.title),
          url: String(url),
          publishedAt: item.pubDate
            ? DateTime.formatIso(DateTime.makeUnsafe(String(item.pubDate)))
            : null,
          sourceName:
            item.source?.["#text"] ?? item.source ?? channel.title ?? null,
        },
      ];
    });
  }

  const entries = asArray(doc.feed?.entry);
  return entries.flatMap((entry: any) => {
    const link =
      asArray(entry.link).find((candidate: any) => candidate["@_href"]) ??
      entry.link;
    const url = link?.["@_href"] ?? link;
    if (!entry.title || !url) return [];
    return [
      {
        title: String(entry.title?.["#text"] ?? entry.title),
        url: String(url),
        publishedAt: entry.published
          ? DateTime.formatIso(DateTime.makeUnsafe(String(entry.published)))
          : null,
        sourceName: doc.feed?.title ?? null,
      },
    ];
  });
}

export function resolveGoogleNewsUrl(url: string) {
  const parsed = new URL(url);
  const nested = parsed.searchParams.get("url");
  return nested ?? url;
}
