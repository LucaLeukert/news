import {
  type AiResultEnvelope,
  type CrawlEnqueueRequest,
  type LeasedAiJob,
  type ResolveUrlResult,
  type Story,
  type StoryDetail,
  type StoryListQuery,
  aiResultEnvelopeSchema,
  crawlEnqueueRequestSchema,
  leasedAiJobSchema,
  resolveUrlResultSchema,
  storyDetailSchema,
  storyListQuerySchema,
  storySchema,
} from "@news/types";
import { Context, Effect, Layer, Schema } from "effect";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import {
  Rpc,
  RpcClient,
  RpcGroup,
  RpcSerialization,
} from "effect/unstable/rpc";
import { HttpError } from "./errors";

export const NewsRpcErrorSchema = Schema.Struct({
  message: Schema.String,
});

export type NewsRpcError = typeof NewsRpcErrorSchema.Type;

const QueuedStatusSchema = Schema.Struct({
  status: Schema.Literal("queued"),
});

const AcceptedStatusSchema = Schema.Struct({
  status: Schema.Literal("accepted"),
});

export class NewsRpcs extends RpcGroup.make(
  Rpc.make("ListStories", {
    payload: storyListQuerySchema,
    success: Schema.Array(storySchema),
    error: NewsRpcErrorSchema,
  }),
  Rpc.make("GetStory", {
    payload: { id: Schema.String },
    success: Schema.NullOr(storyDetailSchema),
    error: NewsRpcErrorSchema,
  }),
  Rpc.make("ResolveUrl", {
    payload: { url: Schema.String },
    success: resolveUrlResultSchema,
    error: NewsRpcErrorSchema,
  }),
  Rpc.make("EnqueueCrawl", {
    payload: { request: crawlEnqueueRequestSchema },
    success: QueuedStatusSchema,
    error: NewsRpcErrorSchema,
  }),
  Rpc.make("LeaseAiJob", {
    payload: { nodeId: Schema.String },
    success: Schema.NullOr(leasedAiJobSchema),
    error: NewsRpcErrorSchema,
  }),
  Rpc.make("SubmitAiJobResult", {
    payload: { result: aiResultEnvelopeSchema },
    success: AcceptedStatusSchema,
    error: NewsRpcErrorSchema,
  }),
) {}

export interface NewsRpcClientShape {
  readonly listStories: (
    query: StoryListQuery,
  ) => Effect.Effect<ReadonlyArray<Story>, HttpError>;
  readonly getStory: (
    id: string,
  ) => Effect.Effect<StoryDetail | null, HttpError>;
  readonly resolveUrl: (
    url: string,
  ) => Effect.Effect<ResolveUrlResult, HttpError>;
  readonly enqueueCrawl: (
    request: CrawlEnqueueRequest,
  ) => Effect.Effect<"queued", HttpError>;
  readonly leaseAiJob: (
    nodeId: string,
  ) => Effect.Effect<LeasedAiJob | null, HttpError>;
  readonly submitAiJobResult: (
    result: AiResultEnvelope,
  ) => Effect.Effect<"accepted", HttpError>;
}

export class NewsRpcClient extends Context.Service<
  NewsRpcClient,
  NewsRpcClientShape
>()("@news/platform/NewsRpcClient") {}

const rpcHeaders = (serviceToken?: string) =>
  serviceToken ? { "x-service-token": serviceToken } : undefined;

const normalizeRpcUrl = (apiBaseUrl: string) =>
  `${apiBaseUrl.replace(/\/+$/, "")}/rpc`;

const mapRpcError = (cause: unknown) =>
  new HttpError({ message: "News RPC request failed", cause });

export const NewsRpcClientLive = (input: {
  readonly apiBaseUrl: string;
  readonly serviceToken?: string;
}) => {
  const ProtocolLive = RpcClient.layerProtocolHttp({
    url: normalizeRpcUrl(input.apiBaseUrl),
  }).pipe(
    Layer.provide(
      Layer.merge(FetchHttpClient.layer, RpcSerialization.layerNdjson),
    ),
  );

  return Layer.effect(NewsRpcClient)(
    Effect.gen(function* () {
      const client = yield* RpcClient.make(NewsRpcs);
      const headers = rpcHeaders(input.serviceToken);
      return {
        listStories: (query) =>
          client
            .ListStories(query, { headers })
            .pipe(Effect.mapError(mapRpcError)),
        getStory: (id) =>
          client
            .GetStory({ id }, { headers })
            .pipe(Effect.mapError(mapRpcError)),
        resolveUrl: (url) =>
          client
            .ResolveUrl({ url }, { headers })
            .pipe(Effect.mapError(mapRpcError)),
        enqueueCrawl: (request) =>
          client.EnqueueCrawl({ request }, { headers }).pipe(
            Effect.map((response) => response.status),
            Effect.mapError(mapRpcError),
          ),
        leaseAiJob: (nodeId) =>
          client
            .LeaseAiJob({ nodeId }, { headers })
            .pipe(Effect.mapError(mapRpcError)),
        submitAiJobResult: (result) =>
          client.SubmitAiJobResult({ result }, { headers }).pipe(
            Effect.map((response) => response.status),
            Effect.mapError(mapRpcError),
          ),
      } satisfies NewsRpcClientShape;
    }),
  ).pipe(Layer.provide(ProtocolLive));
};
