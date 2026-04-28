import { AiGateway, AiGatewayError } from "@news/platform";
import { Context, Effect, Layer } from "effect";
import type { z } from "zod";
import {
  type AiModelPolicy,
  type GenerativeModelFeature,
  modelForFeature,
  modelPolicy,
} from "./model-policy";

export interface StructuredAiServiceShape {
  readonly generateJson: <T extends z.ZodTypeAny>(input: {
    readonly prompt: string;
    readonly schema: T;
    readonly feature: GenerativeModelFeature;
    readonly model?: string;
  }) => Effect.Effect<z.infer<T>, AiGatewayError>;
  readonly embedDocuments: (input: {
    readonly texts: ReadonlyArray<string>;
  }) => Effect.Effect<ReadonlyArray<ReadonlyArray<number>>, AiGatewayError>;
  readonly rerankDocuments: (input: {
    readonly query: string;
    readonly documents: ReadonlyArray<string>;
    readonly topN?: number;
  }) => Effect.Effect<
    ReadonlyArray<{
      readonly originalIndex: number;
      readonly score: number;
      readonly document: string;
    }>,
    AiGatewayError
  >;
}

export class StructuredAiService extends Context.Service<
  StructuredAiService,
  StructuredAiServiceShape
>()("@news/ai/StructuredAiService") {}

export const StructuredAiLive = (policy: AiModelPolicy = modelPolicy) =>
  Layer.effect(
    StructuredAiService,
    Effect.gen(function* () {
      const gateway = yield* AiGateway;
      return {
        generateJson: <T extends z.ZodTypeAny>(input: {
          readonly prompt: string;
          readonly schema: T;
          readonly feature: GenerativeModelFeature;
          readonly model?: string;
        }) =>
          gateway.generateObject({
            prompt: input.prompt,
            schema: input.schema,
            model: input.model ?? modelForFeature(input.feature, policy),
            maxRetries: 0,
          }),
        embedDocuments: (input: { readonly texts: ReadonlyArray<string> }) =>
          gateway.embedDocuments({
            texts: input.texts,
            model: modelForFeature("embeddings", policy),
            maxRetries: 0,
          }),
        rerankDocuments: (input: {
          readonly query: string;
          readonly documents: ReadonlyArray<string>;
          readonly topN?: number;
        }) =>
          gateway.rerankDocuments({
            query: input.query,
            documents: input.documents,
            topN: input.topN,
            model: modelForFeature("reranking", policy),
            maxRetries: 0,
          }),
      } satisfies StructuredAiServiceShape;
    }),
  );

export const generateStructuredJson = <T extends z.ZodTypeAny>(input: {
  readonly prompt: string;
  readonly schema: T;
  readonly feature: GenerativeModelFeature;
  readonly model?: string;
}): Effect.Effect<
  z.infer<T>,
  AiGatewayError,
  StructuredAiService | AiGateway
> =>
  Effect.gen(function* () {
    const service = yield* StructuredAiService;
    return yield* service.generateJson(input);
  });

export const generateEmbeddings = (input: {
  readonly texts: ReadonlyArray<string>;
}): Effect.Effect<
  ReadonlyArray<ReadonlyArray<number>>,
  AiGatewayError,
  StructuredAiService | AiGateway
> =>
  Effect.gen(function* () {
    const service = yield* StructuredAiService;
    return yield* service.embedDocuments(input);
  });

export const rerankDocuments = (input: {
  readonly query: string;
  readonly documents: ReadonlyArray<string>;
  readonly topN?: number;
}): Effect.Effect<
  ReadonlyArray<{
    readonly originalIndex: number;
    readonly score: number;
    readonly document: string;
  }>,
  AiGatewayError,
  StructuredAiService | AiGateway
> =>
  Effect.gen(function* () {
    const service = yield* StructuredAiService;
    return yield* service.rerankDocuments(input);
  });

export const mockStructuredOutput = <T extends z.ZodTypeAny>(
  schema: T,
  fallback: z.infer<T>,
) =>
  Effect.try({
    try: () => schema.parse(fallback),
    catch: (cause) =>
      new AiGatewayError({
        message: "Mock structured output failed schema validation",
        cause,
      }),
  });
