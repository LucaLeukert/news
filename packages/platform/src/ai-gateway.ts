import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { Output, embedMany, generateText, rerank } from "ai";
import { Clock, Context, Effect, Layer } from "effect";
import type { z } from "zod";
import type { ServerEnv } from "./env";
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

export const makeAiGateway = Effect.fn(function* (
  env: Pick<ServerEnv, "LOCAL_MODEL_BASE_URL" | "LOCAL_MODEL_NAME">,
): Effect.fn.Return<AiGatewayShape, never, MetricsService> {
  const metrics = yield* MetricsService;
  const lmstudio = createOpenAICompatible({
    name: "lmstudio",
    baseURL: env.LOCAL_MODEL_BASE_URL,
  });

  return {
    generateText: ({
      prompt,
      model = env.LOCAL_MODEL_NAME,
      maxRetries = 0,
    }) => {
      return Effect.gen(function* () {
        const started = yield* Clock.currentTimeMillis;
        return yield* Effect.tryPromise({
          try: () =>
            generateText({
              model: lmstudio(model),
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
      model = env.LOCAL_MODEL_NAME,
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
              model: lmstudio(model),
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
    embedDocuments: ({ texts, model = env.LOCAL_MODEL_NAME, maxRetries = 0 }) =>
      Effect.gen(function* () {
        const started = yield* Clock.currentTimeMillis;
        return yield* Effect.tryPromise({
          try: () =>
            embedMany({
              model: lmstudio.embeddingModel(model),
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
      model = env.LOCAL_MODEL_NAME,
      maxRetries = 0,
    }) =>
      Effect.gen(function* () {
        const started = yield* Clock.currentTimeMillis;
        const rerankingModelFactory = lmstudio.rerankingModel;
        if (!rerankingModelFactory) {
          return yield* new AiGatewayError({
            message: "Configured provider does not support reranking models",
          });
        }

        return yield* Effect.tryPromise({
          try: () =>
            rerank({
              model: rerankingModelFactory(model),
              query,
              documents: [...documents],
              topN,
              maxRetries,
            }).then(({ ranking }) => ranking),
          catch: (cause) =>
            new AiGatewayError({
              message: "Local reranking failed",
              cause,
            }),
        }).pipe(
          Effect.tap(() =>
            Effect.gen(function* () {
              const finished = yield* Clock.currentTimeMillis;
              yield* Effect.logInfo("ai.rerank.completed", {
                model,
                count: documents.length,
                latencyMs: finished - started,
              });
            }),
          ),
          Effect.catchTag("AiGatewayError", (error) =>
            Effect.gen(function* () {
              yield* metrics.increment("ai.schema_failure", { model });
              yield* Effect.logWarning("ai.rerank.failed", error);
              return yield* error;
            }),
          ),
        );
      }),
  } satisfies AiGatewayShape;
});

export const AiGatewayLayer = (
  env: Pick<ServerEnv, "LOCAL_MODEL_BASE_URL" | "LOCAL_MODEL_NAME">,
) => Layer.effect(AiGateway, makeAiGateway(env));

export const AiGatewayLive = (
  env: Pick<ServerEnv, "LOCAL_MODEL_BASE_URL" | "LOCAL_MODEL_NAME">,
) => AiGatewayLayer(env).pipe(Layer.provide(MetricsLive));
