import type { AiJobType } from "@news/types";

export const modelPolicy = {
  extraction: "google/gemma-4-e4b",
  classification: "google/gemma-4-e4b",
  embeddings: "text-embedding-qwen3-embedding-0.6b",
  reranking: "qwen3-reranker-0.6b",
  editorialReview: "google/gemma-4-e4b",
  publicSummary: "google/gemma-4-e4b",
} as const;

export const localTestModelPolicy = {
  extraction: "gemma3:1b",
  classification: "gemma3:1b",
  embeddings: "gemma3:1b",
  reranking: "gemma3:1b",
  editorialReview: "gemma3:1b",
  publicSummary: "gemma3:1b",
} as const;

export interface AiModelPolicy {
  readonly extraction: string;
  readonly classification: string;
  readonly embeddings: string;
  readonly reranking: string;
  readonly editorialReview: string;
  readonly publicSummary: string;
}

export type ModelPolicyFeature = keyof AiModelPolicy;
export type ModelPolicyName = AiModelPolicy[ModelPolicyFeature];
export type GenerativeModelFeature = Exclude<
  ModelPolicyFeature,
  "embeddings" | "reranking"
>;
export type ModelPolicyProfileName = "real" | "local_test";

export interface ModelPolicyRuntimeEnv {
  readonly AI_MODEL_POLICY_PROFILE: ModelPolicyProfileName;
  readonly AI_MODEL_REAL_EXTRACTION: string;
  readonly AI_MODEL_REAL_CLASSIFICATION: string;
  readonly AI_MODEL_REAL_EMBEDDINGS: string;
  readonly AI_MODEL_REAL_RERANKING: string;
  readonly AI_MODEL_REAL_EDITORIAL_REVIEW: string;
  readonly AI_MODEL_REAL_PUBLIC_SUMMARY: string;
  readonly AI_MODEL_LOCAL_TEST_EXTRACTION: string;
  readonly AI_MODEL_LOCAL_TEST_CLASSIFICATION: string;
  readonly AI_MODEL_LOCAL_TEST_EMBEDDINGS: string;
  readonly AI_MODEL_LOCAL_TEST_RERANKING: string;
  readonly AI_MODEL_LOCAL_TEST_EDITORIAL_REVIEW: string;
  readonly AI_MODEL_LOCAL_TEST_PUBLIC_SUMMARY: string;
}

export const aiJobModelFeatures = {
  article_extraction_qa: "extraction",
  claim_extraction: "extraction",
  story_clustering_support: "classification",
  semantic_story_clustering_support: "classification",
  neutral_story_summary: "publicSummary",
  bias_context_classification: "classification",
  factuality_reliability_support: "classification",
  ownership_extraction_support: "extraction",
  safety_compliance_check: "editorialReview",
} as const satisfies Record<AiJobType, GenerativeModelFeature>;

export const resolveModelPolicy = (env: ModelPolicyRuntimeEnv): AiModelPolicy =>
  env.AI_MODEL_POLICY_PROFILE === "real"
    ? {
        extraction: env.AI_MODEL_REAL_EXTRACTION,
        classification: env.AI_MODEL_REAL_CLASSIFICATION,
        embeddings: env.AI_MODEL_REAL_EMBEDDINGS,
        reranking: env.AI_MODEL_REAL_RERANKING,
        editorialReview: env.AI_MODEL_REAL_EDITORIAL_REVIEW,
        publicSummary: env.AI_MODEL_REAL_PUBLIC_SUMMARY,
      }
    : {
        extraction: env.AI_MODEL_LOCAL_TEST_EXTRACTION,
        classification: env.AI_MODEL_LOCAL_TEST_CLASSIFICATION,
        embeddings: env.AI_MODEL_LOCAL_TEST_EMBEDDINGS,
        reranking: env.AI_MODEL_LOCAL_TEST_RERANKING,
        editorialReview: env.AI_MODEL_LOCAL_TEST_EDITORIAL_REVIEW,
        publicSummary: env.AI_MODEL_LOCAL_TEST_PUBLIC_SUMMARY,
      };

export const modelForFeature = (
  feature: ModelPolicyFeature,
  policy: AiModelPolicy = modelPolicy,
) => policy[feature];

export const featureForAiJobType = (jobType: AiJobType) =>
  aiJobModelFeatures[jobType];

export const modelForAiJobType = (
  jobType: AiJobType,
  policy: AiModelPolicy = modelPolicy,
) => modelForFeature(featureForAiJobType(jobType), policy);

export const aiJobTypesForModel = (
  model: string,
  policy: AiModelPolicy = modelPolicy,
) =>
  (Object.keys(aiJobModelFeatures) as AiJobType[]).filter(
    (jobType) => modelForAiJobType(jobType, policy) === model,
  );

export const modelSequence = (
  policy: AiModelPolicy = modelPolicy,
): ReadonlyArray<ModelPolicyName> =>
  Array.from(new Set(Object.values(policy))) as ReadonlyArray<ModelPolicyName>;
