import {
  AuthService,
  MetricsService,
  type NewsRpcError,
  NewsRpcs,
  loadServerEnv,
  makeAppLayer,
} from "@news/platform";
import {
  type AiResultEnvelope,
  type CrawlEnqueueRequest,
  aiResultEnvelopeSchema,
  articleMetadataSchema,
  decodeUnknownSync,
  resolveUrlRequestSchema,
  storyListQuerySchema,
  storySchema,
} from "@news/types";
import { Data, DateTime, Effect, Layer, Option } from "effect";
import * as Headers from "effect/unstable/http/Headers";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import { RpcSerialization, RpcServer } from "effect/unstable/rpc";
import { FixtureNewsRepositoryLive, NewsRepository } from "./repository";

export interface Env {
  DATABASE_URL?: string;
  CRAWL_QUEUE?: Queue;
  AI_QUEUE?: Queue;
  CRAWL_ARTIFACTS?: R2Bucket;
  CLERK_SECRET_KEY?: string;
  LOCAL_MODEL_BASE_URL?: string;
  LOCAL_MODEL_NAME?: string;
  INTERNAL_SERVICE_TOKEN?: string;
}

function json(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control":
        init.status && init.status >= 400 ? "no-store" : "public, max-age=60",
      ...init.headers,
    },
  });
}

const notFound = () => json({ error: "not_found" }, { status: 404 });

class ApiRequestError extends Data.TaggedError("ApiRequestError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

type QueueMessage =
  | (CrawlEnqueueRequest & { readonly queuedAt: string })
  | {
      readonly type: "resolve_url";
      readonly url: string;
      readonly queuedAt: string;
      readonly requestedBy?: string | null;
    }
  | {
      readonly type: "ai_result";
      readonly result: AiResultEnvelope;
    };

const parseJson = <A>(request: Request, parse: (value: unknown) => A) =>
  Effect.tryPromise({
    try: () => request.json(),
    catch: (cause) =>
      new ApiRequestError({ message: "Request JSON parsing failed", cause }),
  }).pipe(Effect.map(parse));

function requireRpcInternalAuth(headers: Headers.Headers, env: Env) {
  const serviceToken = Headers.get(headers, "x-service-token");
  const accessJwt = Headers.get(headers, "cf-access-jwt-assertion");
  const expectedToken = env.INTERNAL_SERVICE_TOKEN ?? "local-dev";
  return (
    Option.isSome(accessJwt) ||
    (Option.isSome(serviceToken) && serviceToken.value === expectedToken)
  );
}

const toRpcError = (error: unknown): NewsRpcError => ({
  message: error instanceof Error ? error.message : "RPC request failed",
});

const unauthorizedRpcError = (message: string): NewsRpcError => ({ message });

const decodeStory = decodeUnknownSync(storySchema);
const decodeArticleMetadata = decodeUnknownSync(articleMetadataSchema);
const decodeAiResultEnvelope = decodeUnknownSync(aiResultEnvelopeSchema);
const decodeResolveUrlRequest = decodeUnknownSync(resolveUrlRequestSchema);
const decodeStoryListQuery = decodeUnknownSync(storyListQuerySchema);

function storyListQueryFromUrl(url: URL) {
  const query: {
    topic?: string;
    country?: string;
    language?: string;
    source?: string;
    entity?: string;
    imbalance?: boolean;
  } = {};
  const assignString = (
    key: "topic" | "country" | "language" | "source" | "entity",
  ) => {
    const value = url.searchParams.get(key);
    if (value !== null) query[key] = value;
  };
  assignString("topic");
  assignString("country");
  assignString("language");
  assignString("source");
  assignString("entity");
  const imbalance = url.searchParams.get("imbalance");
  if (imbalance !== null)
    query.imbalance = imbalance === "true" || imbalance === "1";
  return decodeStoryListQuery(query);
}

const enqueue = (queue: Queue | undefined, body: QueueMessage) =>
  Effect.tryPromise({
    try: () => queue?.send(body).then(() => undefined) ?? Promise.resolve(),
    catch: (cause) =>
      new ApiRequestError({ message: "Queue enqueue failed", cause }),
  });

const nowIso = DateTime.now.pipe(Effect.map(DateTime.formatIso));

const isoAfter = (duration: Parameters<typeof DateTime.addDuration>[1]) =>
  DateTime.now.pipe(
    Effect.map((now) => DateTime.addDuration(now, duration)),
    Effect.map(DateTime.formatIso),
  );

const makeRpcHandlersLayer = (env: Env) =>
  NewsRpcs.toLayer(
    Effect.gen(function* () {
      const repository = yield* NewsRepository;
      return {
        ListStories: (query) =>
          Effect.gen(function* () {
            const stories = yield* repository.listStories(query);
            return stories.map((story) => decodeStory(story));
          }).pipe(Effect.mapError(toRpcError)),
        GetStory: ({ id }) =>
          Effect.gen(function* () {
            const detail = yield* repository.getStory(id);
            if (!detail) return null;
            return {
              story: decodeStory(detail.story),
              articles: detail.articles.map((article) =>
                decodeArticleMetadata(article),
              ),
            };
          }).pipe(Effect.mapError(toRpcError)),
        ResolveUrl: ({ url }) =>
          Effect.gen(function* () {
            const resolved = yield* repository.resolveUrl(url);
            if (resolved.storyId) {
              return {
                status: "matched" as const,
                url,
                storyId: resolved.storyId,
                articleId: resolved.articleId,
                queued: false as const,
              };
            }
            yield* enqueue(env.CRAWL_QUEUE, {
              type: "resolve_url",
              url,
              queuedAt: yield* nowIso,
            });
            return {
              status: "queued_or_matched" as const,
              url,
              storyId: null,
              queued: true as const,
            };
          }).pipe(Effect.mapError(toRpcError)),
        EnqueueCrawl: ({ request }, options) =>
          Effect.gen(function* () {
            if (!requireRpcInternalAuth(options.headers, env)) {
              return yield* Effect.fail(
                unauthorizedRpcError("Unauthorized RPC crawl enqueue"),
              );
            }
            yield* enqueue(env.CRAWL_QUEUE, {
              ...request,
              queuedAt: yield* nowIso,
            });
            return { status: "queued" as const };
          }).pipe(Effect.mapError(toRpcError)),
        LeaseAiJob: (_payload, options) =>
          Effect.gen(function* () {
            if (!requireRpcInternalAuth(options.headers, env)) {
              return yield* Effect.fail(
                unauthorizedRpcError("Unauthorized RPC AI lease"),
              );
            }
            const stories = yield* repository.listStories({});
            const story = stories[0];
            if (!story) return null;
            const detail = yield* repository.getStory(story.id);
            return {
              id: "00000000-0000-4000-8000-000000000301",
              type: "neutral_story_summary" as const,
              payload: {
                storyTitle: story.title,
                articles: (detail?.articles ?? []).map((article) => ({
                  id: article.id,
                  title: article.title,
                  snippet: article.snippet,
                  source: article.publisher,
                })),
              },
              inputArtifactIds: (detail?.articles ?? []).map(
                (article) => article.id,
              ),
              leaseExpiresAt: yield* isoAfter("60 seconds"),
            };
          }).pipe(Effect.mapError(toRpcError)),
        SubmitAiJobResult: ({ result }, options) =>
          Effect.gen(function* () {
            if (!requireRpcInternalAuth(options.headers, env)) {
              return yield* Effect.fail(
                unauthorizedRpcError("Unauthorized RPC AI result submission"),
              );
            }
            const parsed = decodeAiResultEnvelope(result);
            yield* enqueue(env.AI_QUEUE, { type: "ai_result", result: parsed });
            return { status: "accepted" as const };
          }).pipe(Effect.mapError(toRpcError)),
      };
    }),
  );

function handleRpcApi(request: Request, path: string, env: Env) {
  return Effect.gen(function* () {
    if (path !== "/rpc") return null;
    const rpcResponse = yield* RpcServer.toHttpEffect(NewsRpcs).pipe(
      Effect.flatten,
      Effect.provideService(
        HttpServerRequest.HttpServerRequest,
        HttpServerRequest.fromWeb(request),
      ),
      Effect.scoped,
      Effect.provide(
        Layer.merge(makeRpcHandlersLayer(env), RpcSerialization.layerNdjson),
      ),
    );
    return HttpServerResponse.toWeb(rpcResponse);
  });
}

function handleReadApi(request: Request, path: string, env: Env) {
  return Effect.gen(function* () {
    const metrics = yield* MetricsService;
    const auth = yield* AuthService;
    const repository = yield* NewsRepository;
    const identity = yield* auth.getIdentityFromRequest(request).pipe(
      Effect.catchIf(
        () => true,
        () => Effect.succeed({ userId: null, orgId: null, sessionId: null }),
      ),
    );

    if (path === "/stories" && request.method === "GET") {
      const url = new URL(request.url);
      const query = storyListQueryFromUrl(url);
      const stories = yield* repository.listStories(query);
      yield* metrics.increment("queue.depth", { surface: "stories" });
      return json({
        stories: stories.map((story) => decodeStory(story)),
        viewer: identity.userId,
        source: env.DATABASE_URL ? "postgres" : "fixture",
      });
    }

    if (path.startsWith("/stories/") && request.method === "GET") {
      const id = path.split("/").at(-1) ?? "";
      const detail = yield* repository.getStory(id);
      if (!detail) return notFound();
      return json({
        story: decodeStory(detail.story),
        articles: detail.articles.map((article) =>
          decodeArticleMetadata(article),
        ),
      });
    }

    if (path.startsWith("/articles/") && request.method === "GET") {
      const id = path.split("/").at(-1) ?? "";
      const article = yield* repository.getArticle(id);
      return article
        ? json({ article: decodeArticleMetadata(article) })
        : notFound();
    }

    if (path.startsWith("/sources/") && request.method === "GET") {
      const id = path.split("/").at(-1) ?? "";
      const source = yield* repository.getSource(id);
      return source ? json({ source }) : notFound();
    }

    if (path === "/search" && request.method === "GET") {
      const query = new URL(request.url).searchParams.get("q") ?? "";
      const results = yield* repository.search(query);
      return json({
        query,
        stories: results.stories.map((story) => decodeStory(story)),
        articles: results.articles.map((article) =>
          decodeArticleMetadata(article),
        ),
      });
    }

    return null;
  });
}

function handleWriteApi(request: Request, path: string, env: Env) {
  return Effect.gen(function* () {
    const auth = yield* AuthService;
    const repository = yield* NewsRepository;
    const identity = yield* auth.getIdentityFromRequest(request).pipe(
      Effect.catchIf(
        () => true,
        () => Effect.succeed({ userId: null, orgId: null, sessionId: null }),
      ),
    );

    if (path === "/resolve-url" && request.method === "POST") {
      const body = yield* parseJson(request, decodeResolveUrlRequest);
      const resolved = yield* repository.resolveUrl(body.url);
      if (resolved.storyId) {
        return json({
          status: "matched",
          url: body.url,
          storyId: resolved.storyId,
          articleId: resolved.articleId,
          queued: false,
        });
      }
      yield* enqueue(env.CRAWL_QUEUE, {
        type: "resolve_url",
        url: body.url,
        requestedBy: identity.userId,
        queuedAt: yield* nowIso,
      });
      return json({
        status: "queued_or_matched",
        url: body.url,
        storyId: null,
        queued: true,
      });
    }

    return null;
  });
}

function runtimeEnv(env: Env) {
  return {
    DATABASE_URL: env.DATABASE_URL,
    CLERK_SECRET_KEY: env.CLERK_SECRET_KEY,
    LOCAL_MODEL_BASE_URL: env.LOCAL_MODEL_BASE_URL,
    LOCAL_MODEL_NAME: env.LOCAL_MODEL_NAME,
  };
}

export default {
  fetch(request: Request, env: Env) {
    const program = Effect.gen(function* () {
      const parsedEnv = yield* loadServerEnv(runtimeEnv(env));
      const url = new URL(request.url);
      const handler = Effect.gen(function* () {
        const rpc = yield* handleRpcApi(request, url.pathname, env);
        if (rpc) return rpc;

        const read = yield* handleReadApi(request, url.pathname, env);
        if (read) return read;

        const write = yield* handleWriteApi(request, url.pathname, env);
        if (write) return write;

        return notFound();
      }).pipe(
        Effect.provide(
          Layer.mergeAll(makeAppLayer(parsedEnv), FixtureNewsRepositoryLive),
        ),
      );

      return yield* handler;
    }).pipe(
      Effect.catchIf(
        () => true,
        (error: unknown) =>
          Effect.succeed(
            json(
              {
                error: "bad_request",
                message:
                  error instanceof Error ? error.message : "Unknown error",
              },
              { status: 400 },
            ),
          ),
      ),
    );

    return Effect.runPromise(program);
  },
};
