import type { AiJobType } from "@news/types";

export const modelPolicy = {
  extraction: "google/gemma-4-e4b",
  classification: "google/gemma-4-e4b",
  embeddings: "text-embedding-qwen3-embedding-0.6b",
  reranking: "qwen3-reranker-0.6b",
  editorialReview: "google/gemma-4-e4b",
  publicSummary: "google/gemma-4-e4b",
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

export const aiJobTypesForModel = (model: ModelPolicyName) =>
  (Object.keys(aiJobModelFeatures) as AiJobType[]).filter(
    (jobType) => modelForAiJobType(jobType) === model,
  );

export const modelSequence = Array.from(
  new Set(Object.values(modelPolicy)),
) as ReadonlyArray<ModelPolicyName>;
