import { describe, expect, it } from "vitest";
import {
  looksLikePlaceholderText,
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
