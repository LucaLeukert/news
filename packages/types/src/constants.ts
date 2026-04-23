export const USER_AGENT = "CoverageLensBot/0.1 (+mailto:crawl@example.com)";

export const AI_CONFIDENCE = {
  publish: 0.8,
  limited: 0.6,
} as const;

export const SUPPORTED_LANGUAGES = [
  "ar",
  "de",
  "en",
  "es",
  "fr",
  "hi",
  "ja",
  "pt",
  "ru",
  "zh",
] as const;

export const ARTICLE_TYPES = [
  "news",
  "opinion",
  "liveblog",
  "press_release",
  "satire",
  "sponsored",
  "duplicate",
  "non_article",
  "unknown",
] as const;

export const TAXONOMY_BUCKETS = [
  "left",
  "center_left",
  "center",
  "center_right",
  "right",
  "regionalist",
  "state_aligned",
  "religious",
  "populist",
  "mixed_context",
  "insufficient_context",
  "unrated",
] as const;
