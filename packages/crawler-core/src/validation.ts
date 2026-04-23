import { sameRegistrableHost } from "@news/types";
import { DateTime } from "effect";
import type { ExtractedMetadata } from "./extraction";
import type { FeedItem } from "./rss";

export function validateFeedItemAgainstPage(
  item: FeedItem,
  page: ExtractedMetadata,
) {
  if (!sameRegistrableHost(item.url, page.canonicalUrl))
    return "canonical_failed" as const;
  if (!page.title) return "extraction_failed" as const;

  const itemTitle = item.title.toLowerCase().replace(/\s+/g, " ").trim();
  const pageTitle = page.title.toLowerCase().replace(/\s+/g, " ").trim();
  if (
    !pageTitle.includes(itemTitle.slice(0, 40)) &&
    !itemTitle.includes(pageTitle.slice(0, 40))
  ) {
    return "rss_mismatch_title" as const;
  }

  if (item.publishedAt && page.publishedAt) {
    const deltaMs = Math.abs(
      DateTime.toEpochMillis(DateTime.makeUnsafe(item.publishedAt)) -
        DateTime.toEpochMillis(DateTime.makeUnsafe(page.publishedAt)),
    );
    if (deltaMs > 1000 * 60 * 60 * 24 * 2) return "rss_mismatch_date" as const;
  }

  return "rss_verified" as const;
}
