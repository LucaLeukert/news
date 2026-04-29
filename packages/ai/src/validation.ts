import {
  type AiJobType,
  type AiStructuredOutput,
  type AiValidationStatus,
  type StorySummaryOutput,
  normalizeNarrativeText,
  storySummaryLooksSuspicious,
} from "@news/types";

const sanitizeList = (values: ReadonlyArray<string>) =>
  values.map(normalizeNarrativeText).filter((value) => value.length > 0);

export const sanitizeStructuredOutput = (
  jobType: AiJobType,
  output: AiStructuredOutput,
): AiStructuredOutput => {
  if (jobType !== "neutral_story_summary") {
    return output;
  }

  const summary = output as StorySummaryOutput;
  return {
    ...summary,
    neutralSummary: normalizeNarrativeText(summary.neutralSummary),
    agreed: sanitizeList(summary.agreed),
    differs: sanitizeList(summary.differs),
    contestedOrUnverified: sanitizeList(summary.contestedOrUnverified),
    reasons: sanitizeList(summary.reasons),
  } satisfies StorySummaryOutput;
};

export const validationStatusForStructuredOutput = (
  jobType: AiJobType,
  output: AiStructuredOutput,
): AiValidationStatus =>
  jobType === "neutral_story_summary" &&
  storySummaryLooksSuspicious(output as StorySummaryOutput)
    ? "failed_schema_validation"
    : "valid";

export const validationReasonsForStructuredOutput = (
  jobType: AiJobType,
  output: AiStructuredOutput,
) => {
  if (
    jobType === "neutral_story_summary" &&
    storySummaryLooksSuspicious(output as StorySummaryOutput)
  ) {
    return ["semantic_validation: suspicious story summary output"];
  }
  return "reasons" in output ? output.reasons : [];
};
