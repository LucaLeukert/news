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

const htmlNamedEntities = {
  amp: "&",
  quot: '"',
  apos: "'",
  lt: "<",
  gt: ">",
  nbsp: " ",
} as const;

export const decodeHtmlEntities = (value: string) =>
  value.replaceAll(/&(#x?[0-9a-f]+|[a-z]+);/gi, (entity, rawCode) => {
    const code = rawCode.toLowerCase();
    if (code in htmlNamedEntities) {
      return htmlNamedEntities[code as keyof typeof htmlNamedEntities];
    }

    if (code.startsWith("#x")) {
      const parsed = Number.parseInt(code.slice(2), 16);
      return Number.isNaN(parsed) ? entity : String.fromCodePoint(parsed);
    }

    if (code.startsWith("#")) {
      const parsed = Number.parseInt(code.slice(1), 10);
      return Number.isNaN(parsed) ? entity : String.fromCodePoint(parsed);
    }

    return entity;
  });

const toIsoDateOrNull = (value: unknown) => {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  try {
    return DateTime.formatIso(DateTime.makeUnsafe(value));
  } catch {
    return null;
  }
};

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
          title: decodeHtmlEntities(String(item.title)),
          url: String(url),
          publishedAt: toIsoDateOrNull(item.pubDate),
          sourceName:
            typeof (item.source?.["#text"] ?? item.source ?? channel.title) ===
            "string"
              ? decodeHtmlEntities(
                  String(item.source?.["#text"] ?? item.source ?? channel.title),
                )
              : null,
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
          title: decodeHtmlEntities(String(entry.title?.["#text"] ?? entry.title)),
          url: String(url),
          publishedAt: toIsoDateOrNull(entry.published),
          sourceName:
            typeof doc.feed?.title === "string"
              ? decodeHtmlEntities(doc.feed.title)
              : null,
        },
    ];
  });
}

export function resolveGoogleNewsUrl(url: string) {
  const parsed = new URL(url);
  const nested = parsed.searchParams.get("url");
  return nested ?? url;
}
