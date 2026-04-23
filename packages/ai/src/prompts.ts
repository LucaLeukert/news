export const PROMPT_VERSIONS = {
  articleExtractionQa: "article-extraction-qa@2026-04-22",
  claimExtraction: "claim-extraction@2026-04-22",
  storySummary: "story-summary@2026-04-22",
  safetyCompliance: "safety-compliance@2026-04-22",
} as const;

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
    "Return JSON with neutralSummary, agreed, differs, contestedOrUnverified, confidence, reasons.",
    `Story: ${input.storyTitle}`,
    JSON.stringify(input.articles),
  ].join("\n\n");
}
