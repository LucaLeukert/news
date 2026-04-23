import { publicConfidenceState } from "@news/types";

export function canPublishPublicAiOutput(
  confidence: number,
  publishable = true,
) {
  return publishable && publicConfidenceState(confidence) === "publish";
}

export function canUseInAggregateLabels(
  confidence: number,
  publishable = true,
) {
  return canPublishPublicAiOutput(confidence, publishable);
}
