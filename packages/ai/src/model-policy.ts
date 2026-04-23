import type { AiJobType } from "@news/types";

export const modelPolicy = {
  extraction: "Qwen3-4B-Q4_K_M",
  classification: "Qwen3-4B-Q4_K_M",
  embeddings: "Qwen3-Embedding-0.6B",
  reranking: "Qwen3-Reranker-0.6B",
  editorialReview: "Qwen3-14B-Q4_K_M",
  publicSummary: "Qwen3-14B-Q4_K_M",
} as const;

export type ModelPolicyFeature = keyof typeof modelPolicy;
export type ModelPolicyName = (typeof modelPolicy)[ModelPolicyFeature];
export type GenerativeModelFeature = Exclude<
  ModelPolicyFeature,
  "embeddings" | "reranking"
>;

export const aiJobModelFeatures = {
  article_extraction_qa: "extraction",
  claim_extraction: "extraction",
  story_clustering_support: "classification",
  neutral_story_summary: "publicSummary",
  bias_context_classification: "classification",
  factuality_reliability_support: "classification",
  ownership_extraction_support: "extraction",
  safety_compliance_check: "editorialReview",
} as const satisfies Record<AiJobType, GenerativeModelFeature>;

export const modelForFeature = (feature: ModelPolicyFeature) =>
  modelPolicy[feature];

export const featureForAiJobType = (jobType: AiJobType) =>
  aiJobModelFeatures[jobType];

export const modelForAiJobType = (jobType: AiJobType) =>
  modelForFeature(featureForAiJobType(jobType));
