export const PROMPT_VERSIONS = {
  articleExtractionQa: "article-extraction-qa@2026-04-22",
  claimExtraction: "claim-extraction@2026-04-22",
  storyClusteringSupport: "story-clustering-support@2026-04-24",
  storySummary: "story-summary@2026-04-24",
  biasContext: "bias-context@2026-04-24",
  factualityReliability: "factuality-reliability@2026-04-24",
  ownershipExtraction: "ownership-extraction@2026-04-24",
  safetyCompliance: "safety-compliance@2026-04-22",
} as const;

export function articleExtractionQaPrompt(input: {
  readonly article: {
    readonly sourceName: string;
    readonly sourceDomain: string;
    readonly countryCode: string | null;
    readonly title: string;
    readonly snippet: string | null;
    readonly author: string | null;
    readonly publishedAt: string | null;
    readonly language: string | null;
    readonly canonicalUrl: string;
  };
}) {
  return [
    "Review only the supplied article metadata.",
    "Classify whether this looks like a news article, opinion, liveblog, press release, satire, sponsored content, duplicate, or non-article.",
    "Set extraction_valid to false only when the metadata looks too incomplete, mismatched, or obviously not article-like.",
    "If article_type is news, opinion, liveblog, or press_release and title/date/language quality are all valid, extraction_valid should usually be true.",
    "Return JSON with extraction_valid, article_type, title_quality, date_quality, language_quality, reasons, confidence.",
    JSON.stringify(input.article),
  ].join("\n\n");
}

export function claimExtractionPrompt(input: {
  readonly article: {
    readonly sourceName: string;
    readonly countryCode: string | null;
    readonly title: string;
    readonly snippet: string | null;
    readonly author: string | null;
    readonly publishedAt: string | null;
    readonly language: string | null;
  };
}) {
  return [
    "Extract only explicit claims and named entities from the supplied title and snippet.",
    "Do not infer facts beyond the provided metadata. Keep claims atomic and concise.",
    "Return JSON with claims, where each claim has text, speaker, entities, confidence.",
    JSON.stringify(input.article),
  ].join("\n\n");
}

export function storyClusteringSupportPrompt(input: {
  readonly storyTitle: string;
  readonly articles: ReadonlyArray<{
    readonly id: string;
    readonly title: string;
    readonly snippet: string | null;
    readonly source: string;
  }>;
}) {
  return [
    "You are helping group coverage of the same news event.",
    "Using only the supplied article metadata, produce a short semantic fingerprint for the event and a few concise same-event cue phrases.",
    "Do not use outlet names inside the fingerprint.",
    "Return JSON with fingerprint, same_event_candidates, confidence.",
    `Story: ${input.storyTitle}`,
    JSON.stringify(input.articles),
  ].join("\n\n");
}

export function storySummaryPrompt(input: {
  readonly storyTitle: string;
  readonly articles: ReadonlyArray<{
    readonly id: string;
    readonly title: string;
    readonly snippet: string | null;
    readonly source: string;
  }>;
}) {
  return [
    "Summarize only the supplied article metadata and snippets.",
    "Do not add outside knowledge. Do not state that a claim is true unless all supplied sources establish it.",
    "Never output placeholders, ellipses-only text, redacted-looking punctuation, or generic filler like 'the article titled'.",
    "If the supplied metadata is too weak, say so plainly in normal prose and lower confidence instead of emitting malformed text.",
    "Return JSON with neutralSummary, agreed, differs, contestedOrUnverified, confidence, reasons.",
    `Story: ${input.storyTitle}`,
    JSON.stringify(input.articles),
  ].join("\n\n");
}

export function biasContextPrompt(input: {
  readonly source: {
    readonly sourceName: string;
    readonly domain: string;
    readonly countryCode: string | null;
    readonly primaryLanguage: string | null;
    readonly recentArticleTitles: ReadonlyArray<string>;
  };
}) {
  return [
    "Assess the likely editorial taxonomy context of this source using only the supplied source metadata and recent headlines.",
    "Use insufficient_context aggressively when the evidence is weak. publishable should be false when the label should stay internal.",
    "Return JSON with taxonomy_bucket, country_context, publishable, evidence_strength, confidence, reasons.",
    JSON.stringify(input.source),
  ].join("\n\n");
}

export function factualityReliabilityPrompt(input: {
  readonly source: {
    readonly sourceName: string;
    readonly domain: string;
    readonly countryCode: string | null;
    readonly recentArticleTitles: ReadonlyArray<string>;
  };
}) {
  return [
    "Estimate source-quality signals from the supplied source metadata and recent headlines only.",
    "Do not claim objective truth. Focus on sourcing quality indicators, sensational framing risk, and evidence posture.",
    "Return JSON with quality_signals, reliability_band, confidence.",
    JSON.stringify(input.source),
  ].join("\n\n");
}

export function ownershipExtractionPrompt(input: {
  readonly source: {
    readonly sourceName: string;
    readonly domain: string;
    readonly countryCode: string | null;
    readonly primaryLanguage: string | null;
  };
}) {
  return [
    "Infer ownership category only from the supplied source metadata.",
    "If ownership cannot be inferred reliably from this metadata alone, return null ownership_category and publishable false.",
    "Citations must be URLs only when you can ground them directly from the supplied metadata; otherwise return an empty array.",
    "Return JSON with ownership_category, citations, publishable, confidence.",
    JSON.stringify(input.source),
  ].join("\n\n");
}

export function safetyCompliancePrompt(input: {
  readonly storyTitle: string;
  readonly summary: {
    readonly neutralSummary: string;
    readonly agreed: ReadonlyArray<string>;
    readonly differs: ReadonlyArray<string>;
    readonly contestedOrUnverified: ReadonlyArray<string>;
    readonly confidence: number;
    readonly reasons: ReadonlyArray<string>;
  };
  readonly articles: ReadonlyArray<{
    readonly id: string;
    readonly title: string;
    readonly snippet: string | null;
    readonly source: string;
  }>;
}) {
  return [
    "Review the proposed public summary for compliance and editorial safety.",
    "Flag unsupported certainty, defamatory certainty, overlong copyrighted phrasing, or policy-sensitive wording.",
    "Return JSON with safe_to_publish, risks, confidence, reasons.",
    `Story: ${input.storyTitle}`,
    JSON.stringify(input.summary),
    JSON.stringify(input.articles),
  ].join("\n\n");
}
