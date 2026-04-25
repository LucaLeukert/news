import {
  ARTICLE_TYPES,
  TAXONOMY_BUCKETS,
  aiResultEnvelopeSchema,
  decodeUnknownSync,
} from "@news/types";
import { z } from "zod";

const articleTypeZodSchema = z.enum(ARTICLE_TYPES);
const taxonomyBucketZodSchema = z.enum(TAXONOMY_BUCKETS);
const confidenceZodSchema = z.preprocess((value) => {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim().length > 0
        ? Number(value)
        : value;
  if (typeof parsed !== "number" || Number.isNaN(parsed)) {
    return parsed;
  }
  if (parsed < 0) return 0;
  if (parsed > 1 && parsed <= 10) return parsed / 10;
  if (parsed > 1) return 1;
  return parsed;
}, z.number().min(0).max(1));

export const articleExtractionQaOutputSchema = z.object({
  extraction_valid: z.boolean(),
  article_type: articleTypeZodSchema,
  title_quality: z.enum(["valid", "missing", "clickbait", "mismatch"]),
  date_quality: z.enum(["valid", "missing", "mismatch", "ambiguous"]),
  language_quality: z.enum(["valid", "missing", "mismatch"]),
  reasons: z.array(z.string()),
  confidence: confidenceZodSchema,
});

export const claimExtractionOutputSchema = z.object({
  claims: z.array(
    z.object({
      text: z.string().max(500),
      speaker: z.string().nullable(),
      entities: z.array(z.string()),
      confidence: confidenceZodSchema,
    }),
  ),
  confidence: confidenceZodSchema,
});

export const storySummaryOutputSchema = z.object({
  neutralSummary: z.string().max(1600),
  agreed: z.array(z.string().max(500)),
  differs: z.array(z.string().max(500)),
  contestedOrUnverified: z.array(z.string().max(500)),
  confidence: confidenceZodSchema,
  reasons: z.array(z.string()),
});

export const biasContextOutputSchema = z.object({
  taxonomy_bucket: taxonomyBucketZodSchema,
  country_context: z.string().length(2).nullable(),
  publishable: z.boolean(),
  evidence_strength: z.enum(["strong", "moderate", "weak", "none"]),
  confidence: confidenceZodSchema,
  reasons: z.array(z.string()),
});

export const safetyComplianceOutputSchema = z.object({
  safe_to_publish: z.boolean(),
  risks: z.array(
    z.enum([
      "defamatory_certainty",
      "unsupported_truth_claim",
      "overlong_snippet",
      "copyright_leakage",
      "sensitive_policy_output",
    ]),
  ),
  confidence: confidenceZodSchema,
  reasons: z.array(z.string()),
});

export const aiSchemasByJobType = {
  article_extraction_qa: articleExtractionQaOutputSchema,
  claim_extraction: claimExtractionOutputSchema,
  story_clustering_support: z.object({
    fingerprint: z.string(),
    same_event_candidates: z.array(z.string()),
    confidence: confidenceZodSchema,
  }),
  neutral_story_summary: storySummaryOutputSchema,
  bias_context_classification: biasContextOutputSchema,
  factuality_reliability_support: z.object({
    quality_signals: z.array(z.string()),
    reliability_band: z.enum(["high", "medium", "low", "insufficient_context"]),
    confidence: confidenceZodSchema,
  }),
  ownership_extraction_support: z.object({
    ownership_category: z.string().nullable(),
    citations: z.array(z.string().url()),
    publishable: z.boolean(),
    confidence: confidenceZodSchema,
  }),
  safety_compliance_check: safetyComplianceOutputSchema,
} as const;

export function validateAiEnvelope(raw: unknown) {
  try {
    return {
      success: true as const,
      data: decodeUnknownSync(aiResultEnvelopeSchema)(raw),
    };
  } catch (error) {
    return { success: false as const, error };
  }
}
