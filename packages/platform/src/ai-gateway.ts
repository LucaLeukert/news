import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { ServerEnv } from "@news/env";
import { Output, embedMany, generateText } from "ai";
import { Clock, Context, Effect, Layer } from "effect";
import type { z } from "zod";
import { AiGatewayError } from "./errors";
import { MetricsLive, MetricsService } from "./metrics";

export interface AiGatewayShape {
  readonly generateText: (input: {
    readonly prompt: string;
    readonly model?: string;
    readonly maxRetries?: number;
  }) => Effect.Effect<string, AiGatewayError>;
  readonly generateObject: <T extends z.ZodTypeAny>(input: {
    readonly prompt: string;
    readonly schema: T;
    readonly model?: string;
    readonly maxRetries?: number;
  }) => Effect.Effect<z.infer<T>, AiGatewayError>;
  readonly embedDocuments: (input: {
    readonly texts: ReadonlyArray<string>;
    readonly model?: string;
    readonly maxRetries?: number;
  }) => Effect.Effect<ReadonlyArray<ReadonlyArray<number>>, AiGatewayError>;
  readonly rerankDocuments: (input: {
    readonly query: string;
    readonly documents: ReadonlyArray<string>;
    readonly topN?: number;
    readonly model?: string;
    readonly maxRetries?: number;
  }) => Effect.Effect<
    ReadonlyArray<{
      readonly originalIndex: number;
      readonly score: number;
      readonly document: string;
    }>,
    AiGatewayError
  >;
}

export class AiGateway extends Context.Service<AiGateway, AiGatewayShape>()(
  "@news/platform/AiGateway",
) {}

const resolveAiHostBaseUrl = (
  env: Pick<
    ServerEnv,
    "AI_HOST_PROFILE" | "AI_HOST_REAL_BASE_URL" | "AI_HOST_LOCAL_BASE_URL"
  >,
) =>
  env.AI_HOST_PROFILE === "real"
    ? env.AI_HOST_REAL_BASE_URL
    : env.AI_HOST_LOCAL_BASE_URL;

const resolveDefaultModel = (
  env: Pick<
    ServerEnv,
    | "AI_HOST_PROFILE"
    | "AI_HOST_REAL_DEFAULT_MODEL"
    | "AI_HOST_LOCAL_DEFAULT_MODEL"
  >,
) =>
  env.AI_HOST_PROFILE === "real"
    ? env.AI_HOST_REAL_DEFAULT_MODEL
    : env.AI_HOST_LOCAL_DEFAULT_MODEL;

export const makeAiGateway = Effect.fn(function* (
  env: Pick<
    ServerEnv,
    | "AI_HOST_PROFILE"
    | "AI_HOST_REAL_BASE_URL"
    | "AI_HOST_LOCAL_BASE_URL"
    | "AI_HOST_REAL_DEFAULT_MODEL"
    | "AI_HOST_LOCAL_DEFAULT_MODEL"
  >,
): Effect.fn.Return<AiGatewayShape, never, MetricsService> {
  const metrics = yield* MetricsService;
  const defaultModel = resolveDefaultModel(env);
  const aiHost = createOpenAICompatible({
    name: env.AI_HOST_PROFILE,
    baseURL: resolveAiHostBaseUrl(env),
    supportsStructuredOutputs: true,
  });

  return {
    generateText: ({ prompt, model = defaultModel, maxRetries = 0 }) => {
      return Effect.gen(function* () {
        const started = yield* Clock.currentTimeMillis;
        return yield* Effect.tryPromise({
          try: () =>
            generateText({
              model: aiHost(model),
              prompt,
              maxRetries,
            }).then(({ text }) => text),
          catch: (cause) =>
            new AiGatewayError({
              message: "Local LLM generation failed",
              cause,
            }),
        }).pipe(
          Effect.tap((text) =>
            Effect.gen(function* () {
              const finished = yield* Clock.currentTimeMillis;
              const latencyMs = finished - started;
              yield* metrics.gauge("ai.job_latency_ms", latencyMs, {
                model,
              });
              yield* metrics.gauge("ai.confidence", text.length > 0 ? 1 : 0, {
                model,
              });
              yield* Effect.logInfo("ai.generate_text.completed", {
                model,
                latencyMs,
              });
            }),
          ),
          Effect.catchTag("AiGatewayError", (error) =>
            Effect.gen(function* () {
              yield* metrics.increment("ai.schema_failure", { model });
              yield* Effect.logWarning("ai.generate_text.failed", error);
              return yield* error;
            }),
          ),
        );
      });
    },
    generateObject: <T extends z.ZodTypeAny>({
      prompt,
      schema,
      model = defaultModel,
      maxRetries = 0,
    }: {
      readonly prompt: string;
      readonly schema: T;
      readonly model?: string;
      readonly maxRetries?: number;
    }) => {
      return Effect.gen(function* () {
        const started = yield* Clock.currentTimeMillis;
        return yield* Effect.tryPromise({
          try: () =>
            generateText({
              model: aiHost(model),
              output: Output.object({ schema }),
              prompt,
              maxRetries,
            }).then(({ output }) => output as z.infer<T>),
          catch: (cause) =>
            new AiGatewayError({
              message: "Local LLM structured generation failed",
              cause,
            }),
        }).pipe(
          Effect.tap(() =>
            Effect.gen(function* () {
              const finished = yield* Clock.currentTimeMillis;
              const latencyMs = finished - started;
              yield* metrics.gauge("ai.job_latency_ms", latencyMs, {
                model,
              });
              yield* metrics.gauge("ai.confidence", 1, { model });
              yield* Effect.logInfo("ai.generate_object.completed", {
                model,
                latencyMs,
              });
            }),
          ),
          Effect.catchTag("AiGatewayError", (error) =>
            Effect.gen(function* () {
              yield* metrics.increment("ai.schema_failure", { model });
              yield* Effect.logWarning("ai.generate_object.failed", error);
              return yield* error;
            }),
          ),
        );
      });
    },
    embedDocuments: ({ texts, model = defaultModel, maxRetries = 0 }) =>
      Effect.gen(function* () {
        const started = yield* Clock.currentTimeMillis;
        return yield* Effect.tryPromise({
          try: () =>
            embedMany({
              model: aiHost.embeddingModel(model),
              values: [...texts],
              maxRetries,
            }).then(({ embeddings }) => embeddings),
          catch: (cause) =>
            new AiGatewayError({
              message: "Local embedding generation failed",
              cause,
            }),
        }).pipe(
          Effect.tap(() =>
            Effect.gen(function* () {
              const finished = yield* Clock.currentTimeMillis;
              yield* Effect.logInfo("ai.embeddings.completed", {
                model,
                count: texts.length,
                latencyMs: finished - started,
              });
            }),
          ),
          Effect.catchTag("AiGatewayError", (error) =>
            Effect.gen(function* () {
              yield* metrics.increment("ai.schema_failure", { model });
              yield* Effect.logWarning("ai.embeddings.failed", error);
              return yield* error;
            }),
          ),
        );
      }),
    rerankDocuments: ({
      query,
      documents,
      topN,
      model = defaultModel,
      maxRetries = 0,
    }) =>
      Effect.gen(function* () {
        const started = yield* Clock.currentTimeMillis;

        const ranking = yield* Effect.tryPromise({
          try: () =>
            embedMany({
              model: aiHost.embeddingModel(model),
              values: [query, ...documents],
              maxRetries,
            }).then(({ embeddings }) => embeddings),
          catch: (cause) =>
            new AiGatewayError({
              message: "Local embedding generation failed",
              cause,
            }),
        });

        const queryEmbedding = ranking[0];
        if (!queryEmbedding) {
          return yield* new AiGatewayError({
            message: "Missing query embedding",
          });
        }

        const documentEmbeddings = ranking.slice(1);

        const scored = yield* Effect.forEach(
          documents.map((document, index) => ({
            document,
            originalIndex: index,
            embedding: documentEmbeddings[index],
          })),
          ({ document, originalIndex, embedding }) =>
            Effect.gen(function* () {
              if (!embedding) {
                return yield* new AiGatewayError({
                  message: "Missing document embedding",
                });
              }

              const score = yield* cosineSimilarity(queryEmbedding, embedding);

              return {
                document,
                originalIndex,
                score,
              };
            }),
          { concurrency: "unbounded" },
        );

        const result = scored
          .sort((a, b) => b.score - a.score)
          .slice(0, topN ?? scored.length);

        yield* Effect.gen(function* () {
          const finished = yield* Clock.currentTimeMillis;

          yield* Effect.logInfo("ai.rerank.completed", {
            model,
            count: documents.length,
            latencyMs: finished - started,
            strategy: "embedding-cosine-effect",
          });
        });

        return result;
      }).pipe(
        Effect.catchTag("AiGatewayError", (error) =>
          Effect.gen(function* () {
            yield* metrics.increment("ai.schema_failure", { model });
            yield* Effect.logWarning("ai.rerank.failed", error);
            return yield* error;
          }),
        ),
      ),
  } satisfies AiGatewayShape;
});

export const AiGatewayLayer = (
  env: Pick<
    ServerEnv,
    | "AI_HOST_PROFILE"
    | "AI_HOST_REAL_BASE_URL"
    | "AI_HOST_LOCAL_BASE_URL"
    | "AI_HOST_REAL_DEFAULT_MODEL"
    | "AI_HOST_LOCAL_DEFAULT_MODEL"
  >,
) => Layer.effect(AiGateway, makeAiGateway(env));

export const AiGatewayLive = (
  env: Pick<
    ServerEnv,
    | "AI_HOST_PROFILE"
    | "AI_HOST_REAL_BASE_URL"
    | "AI_HOST_LOCAL_BASE_URL"
    | "AI_HOST_REAL_DEFAULT_MODEL"
    | "AI_HOST_LOCAL_DEFAULT_MODEL"
  >,
) => AiGatewayLayer(env).pipe(Layer.provide(MetricsLive));

const cosineSimilarity = (
  a: ReadonlyArray<number>,
  b: ReadonlyArray<number>,
): Effect.Effect<number, AiGatewayError> => {
  if (a.length !== b.length) {
    return Effect.fail(
      new AiGatewayError({
        message: "cosineSimilarity: vectors must have the same length",
      }),
    );
  }

  return Effect.sync(() => {
    let dot = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      const av = a[i] ?? 0;
      const bv = b[i] ?? 0;

      dot += av * bv;
      normA += av * av;
      normB += bv * bv;
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);

    return denominator === 0 ? 0 : dot / denominator;
  });
};
