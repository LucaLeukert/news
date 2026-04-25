import {
  type OperationsSnapshot,
  type AiResultEnvelope,
  type CrawlEnqueueRequest,
  type FailAiJobRequest,
  type LeaseAiJobRequest,
  type LeasedAiJob,
  type ResolveUrlResult,
  type SyncPublicStoryProjectionsRequest,
  type Story,
  type StoryDetail,
  type StoryListQuery,
  operationsSnapshotSchema,
  aiResultEnvelopeSchema,
  crawlEnqueueRequestSchema,
  failAiJobRequestSchema,
  leasedAiJobSchema,
  leaseAiJobRequestSchema,
  resolveUrlResultSchema,
  syncPublicStoryProjectionsRequestSchema,
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
  Rpc.make("GetOperationsSnapshot", {
    payload: Schema.Struct({}),
    success: operationsSnapshotSchema,
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
    payload: leaseAiJobRequestSchema,
    success: Schema.NullOr(leasedAiJobSchema),
    error: NewsRpcErrorSchema,
  }),
  Rpc.make("FailAiJob", {
    payload: failAiJobRequestSchema,
    success: AcceptedStatusSchema,
    error: NewsRpcErrorSchema,
  }),
  Rpc.make("SubmitAiJobResult", {
    payload: { result: aiResultEnvelopeSchema },
    success: AcceptedStatusSchema,
    error: NewsRpcErrorSchema,
  }),
  Rpc.make("SyncPublicStoryProjections", {
    payload: syncPublicStoryProjectionsRequestSchema,
    success: QueuedStatusSchema,
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
  readonly getOperationsSnapshot: () => Effect.Effect<OperationsSnapshot, HttpError>;
  readonly resolveUrl: (
    url: string,
  ) => Effect.Effect<ResolveUrlResult, HttpError>;
  readonly enqueueCrawl: (
    request: CrawlEnqueueRequest,
  ) => Effect.Effect<"queued", HttpError>;
  readonly leaseAiJob: (
    request: LeaseAiJobRequest,
  ) => Effect.Effect<LeasedAiJob | null, HttpError>;
  readonly failAiJob: (
    request: FailAiJobRequest,
  ) => Effect.Effect<"accepted", HttpError>;
  readonly submitAiJobResult: (
    result: AiResultEnvelope,
  ) => Effect.Effect<"accepted", HttpError>;
  readonly syncPublicStoryProjections: (
    request?: SyncPublicStoryProjectionsRequest,
  ) => Effect.Effect<"queued", HttpError>;
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
      Layer.merge(FetchHttpClient.layer, RpcSerialization.layerJson),
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
        getOperationsSnapshot: () =>
          client
            .GetOperationsSnapshot({}, { headers })
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
        leaseAiJob: (request) =>
          client
            .LeaseAiJob(request, { headers })
            .pipe(Effect.mapError(mapRpcError)),
        failAiJob: (request) =>
          client.FailAiJob(request, { headers }).pipe(
            Effect.map((response) => response.status),
            Effect.mapError(mapRpcError),
          ),
        submitAiJobResult: (result) =>
          client.SubmitAiJobResult({ result }, { headers }).pipe(
            Effect.map((response) => response.status),
            Effect.mapError(mapRpcError),
          ),
        syncPublicStoryProjections: (request = {}) =>
          client.SyncPublicStoryProjections(request, { headers }).pipe(
            Effect.map((response) => response.status),
            Effect.mapError(mapRpcError),
          ),
      } satisfies NewsRpcClientShape;
    }),
  ).pipe(Layer.provide(ProtocolLive));
};
