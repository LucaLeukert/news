import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  StructuredAiLive,
  canPublishPublicAiOutput,
  canUseInAggregateLabels,
  featureForAiJobType,
  generateEmbeddings,
  generateStructuredJson,
  modelForAiJobType,
  modelPolicy,
  rerankDocuments,
} from "../packages/ai/src";
import { AiGateway, MetricsNoop } from "../packages/platform/src";
import {
  aiResultEnvelopeSchema,
  decodeUnknownSync,
  publicConfidenceState,
} from "../packages/shared/src";

describe("AI confidence gates", () => {
  it("holds low confidence output out of public surfaces", () => {
    expect(publicConfidenceState(0.59)).toBe("hold");
    expect(canPublishPublicAiOutput(0.79)).toBe(false);
    expect(canUseInAggregateLabels(0.8)).toBe(true);
  });

  it("requires a versioned result envelope", () => {
    const parsed = decodeUnknownSync(aiResultEnvelopeSchema)({
      job_id: "00000000-0000-4000-8000-000000000301",
      model_name: "gpt-oss-20b",
      model_version: "gpt-oss-20b",
      prompt_version: "story-summary@2026-04-22",
      input_artifact_ids: ["00000000-0000-4000-8000-000000000101"],
      output_schema_version: "1",
      structured_output: {
        neutralSummary: "Short summary",
        agreed: ["Inflation data was cited."],
        differs: [],
        contestedOrUnverified: [],
        confidence: 0.86,
        reasons: ["Sufficient agreement across snippets"],
      },
      confidence: 0.86,
      reasons: ["Sufficient agreement across snippets"],
      citations_to_input_ids: ["00000000-0000-4000-8000-000000000101"],
      validation_status: "valid",
      created_at: "2026-04-22T08:30:00.000Z",
      latency_ms: 1200,
    });

    expect(parsed.confidence).toBe(0.86);
  });

  it("maps each AI feature to the configured local model policy", () => {
    expect(modelPolicy).toEqual({
      extraction: "Qwen3-4B-Q4_K_M",
      classification: "Qwen3-4B-Q4_K_M",
      embeddings: "Qwen3-Embedding-0.6B",
      reranking: "Qwen3-Reranker-0.6B",
      editorialReview: "Qwen3-14B-Q4_K_M",
      publicSummary: "Qwen3-14B-Q4_K_M",
    });

    expect(modelForAiJobType("article_extraction_qa")).toBe(
      modelPolicy.extraction,
    );
    expect(modelForAiJobType("bias_context_classification")).toBe(
      modelPolicy.classification,
    );
    expect(modelForAiJobType("story_clustering_support")).toBe(
      modelPolicy.classification,
    );
    expect(modelForAiJobType("safety_compliance_check")).toBe(
      modelPolicy.editorialReview,
    );
    expect(featureForAiJobType("neutral_story_summary")).toBe("publicSummary");
  });

  it("decodes structured model output through Effect layers", async () => {
    let usedModel: string | undefined;
    const AiGatewayTest = Layer.succeed(AiGateway, {
      generateText: () => Effect.succeed(""),
      generateObject: ({ schema, model }) =>
        Effect.sync(() => {
          usedModel = model;
          return schema.parse({
            neutralSummary: "Summary",
            agreed: ["A"],
            differs: [],
            contestedOrUnverified: [],
            confidence: 0.91,
            reasons: ["Fixture"],
          });
        }),
      embedDocuments: () => Effect.succeed([[0.1, 0.2]]),
      rerankDocuments: () =>
        Effect.succeed([{ originalIndex: 0, score: 0.9, document: "doc" }]),
    });

    const output = await Effect.runPromise(
      generateStructuredJson({
        prompt: "Summarize",
        schema: z.object({
          neutralSummary: z.string(),
          agreed: z.array(z.string()),
          differs: z.array(z.string()),
          contestedOrUnverified: z.array(z.string()),
          confidence: z.number(),
          reasons: z.array(z.string()),
        }),
        feature: "publicSummary",
      }).pipe(
        Effect.provide(StructuredAiLive),
        Effect.provide(AiGatewayTest),
        Effect.provide(MetricsNoop),
      ),
    );

    expect(output.confidence).toBe(0.91);
    expect(usedModel).toBe(modelPolicy.publicSummary);
  });

  it("uses embedding and reranking models through their feature helpers", async () => {
    const usedModels: string[] = [];
    const AiGatewayTest = Layer.succeed(AiGateway, {
      generateText: () => Effect.succeed(""),
      generateObject: ({ schema }) => Effect.sync(() => schema.parse({})),
      embedDocuments: ({ model }) =>
        Effect.sync(() => {
          usedModels.push(model ?? "");
          return [[0.1, 0.2, 0.3]];
        }),
      rerankDocuments: ({ model }) =>
        Effect.sync(() => {
          usedModels.push(model ?? "");
          return [{ originalIndex: 0, score: 0.99, document: "A" }];
        }),
    });

    const embeddings = await Effect.runPromise(
      generateEmbeddings({ texts: ["story text"] }).pipe(
        Effect.provide(StructuredAiLive),
        Effect.provide(AiGatewayTest),
        Effect.provide(MetricsNoop),
      ),
    );
    const reranked = await Effect.runPromise(
      rerankDocuments({
        query: "story",
        documents: ["A", "B"],
        topN: 1,
      }).pipe(
        Effect.provide(StructuredAiLive),
        Effect.provide(AiGatewayTest),
        Effect.provide(MetricsNoop),
      ),
    );

    expect(embeddings[0]).toEqual([0.1, 0.2, 0.3]);
    expect(reranked[0]?.document).toBe("A");
    expect(usedModels).toEqual([modelPolicy.embeddings, modelPolicy.reranking]);
  });
});
