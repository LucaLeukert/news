import { DomainValidationError, normalizeUrl } from "@news/types";
import { DateTime, Effect } from "effect";

export type ExtractedMetadata = {
  canonicalUrl: string;
  title: string | null;
  description: string | null;
  author: string | null;
  publishedAt: string | null;
  language: string | null;
  paywalled: boolean;
};

function firstMatch(html: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return decodeHtml(match[1].trim());
  }
  return null;
}

function decodeHtml(value: string) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function toIsoDateOrNull(value: string | null) {
  if (!value) return null;

  try {
    return DateTime.formatIso(DateTime.makeUnsafe(value));
  } catch {
    return null;
  }
}

export function extractMetadata(
  html: string,
  fetchedUrl: string,
): ExtractedMetadata {
  const canonical =
    firstMatch(html, [
      /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i,
    ]) ?? fetchedUrl;
  const base = new URL(fetchedUrl);
  const canonicalUrl = normalizeUrl(new URL(canonical, base).toString());

  const title = firstMatch(html, [
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
    /<title[^>]*>([^<]+)<\/title>/i,
  ]);
  const description = firstMatch(html, [
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i,
  ]);
  const author = firstMatch(html, [
    /<meta[^>]+name=["']author["'][^>]+content=["']([^"']+)["']/i,
    /"author"\s*:\s*"([^"]+)"/i,
  ]);
  const publishedAtRaw = firstMatch(html, [
    /<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i,
    /"datePublished"\s*:\s*"([^"]+)"/i,
  ]);
  const language = firstMatch(html, [/<html[^>]+lang=["']([^"']+)["']/i]);
  const paywalled =
    /isAccessibleForFree"\s*:\s*"?false"?/i.test(html) || /paywall/i.test(html);

  return {
    canonicalUrl,
    title,
    description,
    author,
    publishedAt: toIsoDateOrNull(publishedAtRaw),
    language,
    paywalled,
  };
}

export const extractMetadataEffect = (html: string, fetchedUrl: string) =>
  Effect.try({
    try: () => extractMetadata(html, fetchedUrl),
    catch: (cause) =>
      new DomainValidationError({
        message: "Article metadata extraction failed",
        cause,
      }),
  });

export function makeSnippet(text: string | null, noSnippet = false) {
  if (noSnippet || !text) return null;
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > 280 ? `${clean.slice(0, 277)}...` : clean;
}
