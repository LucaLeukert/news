import { describe, expect, it } from "vitest";
import {
  looksLikePlaceholderText,
  shouldTreatArticleExtractionAsValid,
  storySummaryLooksSuspicious,
} from "./domain";

describe("looksLikePlaceholderText", () => {
  it("flags article-discusses placeholder text", () => {
    expect(
      looksLikePlaceholderText(
        "The article discusses that the investigations against Jerome Powell, …",
      ),
    ).toBe(true);
  });

  it("keeps ordinary narrative text", () => {
    expect(
      looksLikePlaceholderText(
        "European fuel prices fell after the government clarified the temporary tax cut.",
      ),
    ).toBe(false);
  });
});

describe("storySummaryLooksSuspicious", () => {
  it("flags garbled summary payloads", () => {
    expect(
      storySummaryLooksSuspicious({
        neutralSummary:
          "The article discusses that the investigations against Jerome Powell, …",
        agreed: [],
        differs: [],
        contestedOrUnverified: ["…...…… …"],
        confidence: 0.85,
        reasons: ["..."],
      }),
    ).toBe(true);
  });
});

describe("shouldTreatArticleExtractionAsValid", () => {
  it("keeps clearly valid article metadata eligible even when the model flips extraction_valid", () => {
    expect(
      shouldTreatArticleExtractionAsValid({
        extraction_valid: false,
        article_type: "news",
        title_quality: "valid",
        date_quality: "valid",
        language_quality: "valid",
        reasons: [],
        confidence: 0.95,
      }),
    ).toBe(true);
  });

  it("still rejects outputs that are explicitly non-article-like", () => {
    expect(
      shouldTreatArticleExtractionAsValid({
        extraction_valid: false,
        article_type: "non_article",
        title_quality: "valid",
        date_quality: "valid",
        language_quality: "valid",
        reasons: [],
        confidence: 0.95,
      }),
    ).toBe(false);
  });
});
