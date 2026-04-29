import { StructuredAiLive, resolveModelPolicy } from "@news/ai";
import { appendAiJobEvent, createDb } from "@news/db";
import { type ServerEnv, loadServerEnv } from "@news/env";
import {
  AuthService,
  MetricsService,
  type NewsRpcError,
  NewsRpcs,
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
import { Context, Data, DateTime, Effect, Layer, Option } from "effect";
import * as Headers from "effect/unstable/http/Headers";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import { RpcSerialization, RpcServer } from "effect/unstable/rpc";
import { rebuildStoriesAndQueueAiJobs } from "../../../services/crawler/src/pipeline";
import {
  getAdminAiJobDetail,
  ingestAdminArticleUrls,
  listAdminAiJobs,
  loadOperationsSnapshot,
  runAdminFailedVerificationReingest,
} from "./admin";
import {
  enqueueSafetyComplianceJob,
  failAiJobInCanonicalStore,
  leaseAiJobFromCanonicalStore,
  persistAiResultToCanonicalStore,
  syncCanonicalStoriesToConvex,
} from "./canonical";
import {
  FixtureNewsRepositoryLive,
  NewsRepository,
  PostgresNewsRepositoryLive,
  makeFixtureRepository,
} from "./repository";

export interface Env {
  DATABASE_URL?: string;
  CRAWL_QUEUE?: Queue;
  AI_QUEUE?: Queue;
  SYNC_QUEUE?: Queue;
  CRAWL_ARTIFACTS?: R2Bucket;
  CLERK_SECRET_KEY?: string;
  AI_HOST_PROFILE?: string;
  AI_HOST_REAL_BASE_URL?: string;
  AI_HOST_LOCAL_BASE_URL?: string;
  AI_HOST_REAL_DEFAULT_MODEL?: string;
  AI_HOST_LOCAL_DEFAULT_MODEL?: string;
  AI_MODEL_POLICY_PROFILE?: string;
  AI_MODEL_REAL_EXTRACTION?: string;
  AI_MODEL_REAL_CLASSIFICATION?: string;
  AI_MODEL_REAL_EMBEDDINGS?: string;
  AI_MODEL_REAL_RERANKING?: string;
  AI_MODEL_REAL_EDITORIAL_REVIEW?: string;
  AI_MODEL_REAL_PUBLIC_SUMMARY?: string;
  AI_MODEL_LOCAL_TEST_EXTRACTION?: string;
  AI_MODEL_LOCAL_TEST_CLASSIFICATION?: string;
  AI_MODEL_LOCAL_TEST_EMBEDDINGS?: string;
  AI_MODEL_LOCAL_TEST_RERANKING?: string;
  AI_MODEL_LOCAL_TEST_EDITORIAL_REVIEW?: string;
  AI_MODEL_LOCAL_TEST_PUBLIC_SUMMARY?: string;
  INTERNAL_SERVICE_TOKEN?: string;
  NEXT_PUBLIC_CONVEX_URL?: string;
}

type ResponseOptions = HttpServerResponse.Options.WithContentType;

function json(data: unknown, init: ResponseOptions = {}) {
  return HttpServerResponse.json(data, {
    ...init,
    headers: {
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
    }
  | {
      readonly type: "sync_public_story_projections";
      readonly reason: "ai_result";
      readonly jobId: string;
      readonly queuedAt: string;
    };

type WorkerQueueMessage = Extract<QueueMessage, { readonly type: string }>;

const parseJson = <A>(
  request: HttpServerRequest.HttpServerRequest,
  parse: (value: unknown) => A,
) =>
  HttpServerRequest.toWeb(request).pipe(
    Effect.flatMap((webRequest) =>
      Effect.tryPromise({
        try: () => webRequest.json(),
        catch: (cause) =>
          new ApiRequestError({
            message: "Request JSON parsing failed",
            cause,
          }),
      }),
    ),
    Effect.map(parse),
  );

function requireRpcInternalAuth(headers: Headers.Headers, env: Env) {
  const serviceToken = Headers.get(headers, "x-service-token");
  const accessJwt = Headers.get(headers, "cf-access-jwt-assertion");
  const expectedToken = env.INTERNAL_SERVICE_TOKEN ?? "local-dev";
  return (
    Option.isSome(accessJwt) ||
    (Option.isSome(serviceToken) && serviceToken.value === expectedToken)
  );
}

const rpcRequestFromHeaders = (headers: Headers.Headers) =>
  new Request("https://coverage-lens-admin.local/rpc", {
    headers: new globalThis.Headers({ ...headers }),
  });

const authorizeAdminRpc = (headers: Headers.Headers, env: Env) =>
  Effect.gen(function* () {
    if (requireRpcInternalAuth(headers, env)) {
      return;
    }

    const auth = yield* AuthService;
    const identity = yield* auth
      .getIdentityFromRequest(rpcRequestFromHeaders(headers))
      .pipe(
        Effect.catchIf(
          () => true,
          () => Effect.succeed({ userId: null, orgId: null, sessionId: null }),
        ),
      );

    if (!identity.userId) {
      return yield* Effect.fail(unauthorizedRpcError("Unauthorized admin RPC"));
    }
  });

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

const getIdentity = (request: HttpServerRequest.HttpServerRequest) =>
  Effect.gen(function* () {
    const auth = yield* AuthService;
    const webRequest = yield* HttpServerRequest.toWeb(request);
    return yield* auth.getIdentityFromRequest(webRequest).pipe(
      Effect.catchIf(
        () => true,
        () => Effect.succeed({ userId: null, orgId: null, sessionId: null }),
      ),
    );
  });

const withBadRequestFallback = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A | HttpServerResponse.HttpServerResponse, never, R> =>
  effect.pipe(
    Effect.catchIf(
      () => true,
      (error: unknown) =>
        json(
          {
            error: "bad_request",
            message: error instanceof Error ? error.message : "Unknown error",
          },
          { status: 400 },
        ).pipe(Effect.orDie),
    ),
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
        GetOperationsSnapshot: (_payload, options) =>
          Effect.gen(function* () {
            yield* authorizeAdminRpc(options.headers, env);
            if (!env.DATABASE_URL) {
              return yield* Effect.fail(
                unauthorizedRpcError(
                  "DATABASE_URL is required for operations snapshot",
                ),
              );
            }
            return yield* loadOperationsSnapshot({
              databaseUrl: env.DATABASE_URL,
              convexUrl: env.NEXT_PUBLIC_CONVEX_URL,
            }).pipe(Effect.mapError(toRpcError));
          }).pipe(Effect.mapError(toRpcError)),
        ListAdminAiJobs: (payload, options) =>
          Effect.gen(function* () {
            yield* authorizeAdminRpc(options.headers, env);
            if (!env.DATABASE_URL) {
              return yield* Effect.fail(
                unauthorizedRpcError(
                  "DATABASE_URL is required for AI job list",
                ),
              );
            }
            return yield* listAdminAiJobs({
              databaseUrl: env.DATABASE_URL,
              limit: payload.limit,
            }).pipe(Effect.mapError(toRpcError));
          }).pipe(Effect.mapError(toRpcError)),
        GetAdminAiJobDetail: ({ jobId }, options) =>
          Effect.gen(function* () {
            yield* authorizeAdminRpc(options.headers, env);
            if (!env.DATABASE_URL) {
              return yield* Effect.fail(
                unauthorizedRpcError(
                  "DATABASE_URL is required for AI job detail",
                ),
              );
            }
            return yield* getAdminAiJobDetail({
              databaseUrl: env.DATABASE_URL,
              jobId,
            }).pipe(Effect.mapError(toRpcError));
          }).pipe(Effect.mapError(toRpcError)),
        ReingestFailedVerification: (payload, options) =>
          Effect.gen(function* () {
            yield* authorizeAdminRpc(options.headers, env);
            if (!env.DATABASE_URL) {
              return yield* Effect.fail(
                unauthorizedRpcError(
                  "DATABASE_URL is required for failed verification reingest",
                ),
              );
            }
            return yield* runAdminFailedVerificationReingest({
              databaseUrl: env.DATABASE_URL,
              statuses: payload.statuses,
              sourceDomain: payload.sourceDomain,
              limit: payload.limit,
              overrideTitleMismatches: payload.overrideTitleMismatches,
            }).pipe(Effect.mapError(toRpcError));
          }).pipe(Effect.mapError(toRpcError)),
        ManualArticleIntake: (payload, options) =>
          Effect.gen(function* () {
            yield* authorizeAdminRpc(options.headers, env);
            if (!env.DATABASE_URL) {
              return yield* Effect.fail(
                unauthorizedRpcError(
                  "DATABASE_URL is required for manual article intake",
                ),
              );
            }
            return yield* ingestAdminArticleUrls({
              databaseUrl: env.DATABASE_URL,
              urls: payload.urls,
            }).pipe(Effect.mapError(toRpcError));
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
            if (!env.DATABASE_URL) return null;
            const activeModelPolicy = resolveModelPolicy(
              yield* loadServerEnv(runtimeEnv(env)),
            );
            return yield* leaseAiJobFromCanonicalStore(
              env.DATABASE_URL,
              _payload,
              activeModelPolicy,
            ).pipe(Effect.mapError(toRpcError));
          }).pipe(Effect.mapError(toRpcError)),
        FailAiJob: ({ jobId, error }, options) =>
          Effect.gen(function* () {
            if (!requireRpcInternalAuth(options.headers, env)) {
              return yield* Effect.fail(
                unauthorizedRpcError("Unauthorized RPC AI failure submission"),
              );
            }
            if (!env.DATABASE_URL) {
              return yield* Effect.fail(
                unauthorizedRpcError(
                  "DATABASE_URL is required for AI job failure submission",
                ),
              );
            }
            yield* failAiJobInCanonicalStore(env.DATABASE_URL, {
              jobId,
              error,
            }).pipe(Effect.mapError(toRpcError));
            return { status: "accepted" as const };
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
        SyncPublicStoryProjections: (_payload, options) =>
          Effect.gen(function* () {
            if (!requireRpcInternalAuth(options.headers, env)) {
              return yield* Effect.fail(
                unauthorizedRpcError("Unauthorized RPC projection sync"),
              );
            }
            yield* enqueue(env.SYNC_QUEUE, {
              type: "sync_public_story_projections",
              reason: "ai_result",
              jobId: "manual-admin-trigger",
              queuedAt: yield* nowIso,
            });
            return { status: "queued" as const };
          }).pipe(Effect.mapError(toRpcError)),
      };
    }),
  );

const makeHttpRoutesLayer = (env: Env) =>
  Layer.mergeAll(
    HttpRouter.add("GET", "/stories", (request) =>
      withBadRequestFallback(
        Effect.gen(function* () {
          const metrics = yield* MetricsService;
          const repository = yield* NewsRepository;
          const identity = yield* getIdentity(request);
          const webRequest = yield* HttpServerRequest.toWeb(request);
          const stories = yield* repository.listStories(
            storyListQueryFromUrl(new URL(webRequest.url)),
          );
          yield* metrics.increment("queue.depth", { surface: "stories" });
          return yield* json({
            stories: stories.map((story) => decodeStory(story)),
            viewer: identity.userId,
            source: env.DATABASE_URL ? "postgres" : "fixture",
          });
        }),
      ),
    ),
    HttpRouter.add("GET", "/stories/:id", () =>
      withBadRequestFallback(
        Effect.gen(function* () {
          const repository = yield* NewsRepository;
          const { id = "" } = yield* HttpRouter.params;
          const detail = yield* repository.getStory(id);
          if (!detail) return yield* notFound();
          return yield* json({
            story: decodeStory(detail.story),
            articles: detail.articles.map((article) =>
              decodeArticleMetadata(article),
            ),
          });
        }),
      ),
    ),
    HttpRouter.add("GET", "/articles/:id", () =>
      withBadRequestFallback(
        Effect.gen(function* () {
          const repository = yield* NewsRepository;
          const { id = "" } = yield* HttpRouter.params;
          const article = yield* repository.getArticle(id);
          return article
            ? yield* json({ article: decodeArticleMetadata(article) })
            : yield* notFound();
        }),
      ),
    ),
    HttpRouter.add("GET", "/sources/:id", () =>
      withBadRequestFallback(
        Effect.gen(function* () {
          const repository = yield* NewsRepository;
          const { id = "" } = yield* HttpRouter.params;
          const source = yield* repository.getSource(id);
          return source ? yield* json({ source }) : yield* notFound();
        }),
      ),
    ),
    HttpRouter.add("GET", "/search", (request) =>
      withBadRequestFallback(
        Effect.gen(function* () {
          const repository = yield* NewsRepository;
          const webRequest = yield* HttpServerRequest.toWeb(request);
          const query = new URL(webRequest.url).searchParams.get("q") ?? "";
          const results = yield* repository.search(query);
          return yield* json({
            query,
            stories: results.stories.map((story) => decodeStory(story)),
            articles: results.articles.map((article) =>
              decodeArticleMetadata(article),
            ),
          });
        }),
      ),
    ),
    HttpRouter.add("POST", "/resolve-url", (request) =>
      withBadRequestFallback(
        Effect.gen(function* () {
          const repository = yield* NewsRepository;
          const identity = yield* getIdentity(request);
          const body = yield* parseJson(request, decodeResolveUrlRequest);
          const resolved = yield* repository.resolveUrl(body.url);
          if (resolved.storyId) {
            return yield* json({
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
          return yield* json({
            status: "queued_or_matched",
            url: body.url,
            storyId: null,
            queued: true,
          });
        }),
      ),
    ),
  );

const makeRpcRoutesLayer = (env: Env) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const rpcHandler = yield* RpcServer.toHttpEffect(NewsRpcs, {
        disableTracing: true,
      }).pipe(
        Effect.provide(
          Layer.mergeAll(makeRpcHandlersLayer(env), RpcSerialization.layerJson),
        ),
      );

      return Layer.mergeAll(HttpRouter.add("POST", "/rpc", rpcHandler));
    }),
  );

function runtimeEnv(env: Env) {
  return {
    DATABASE_URL: env.DATABASE_URL,
    CLERK_SECRET_KEY: env.CLERK_SECRET_KEY,
    AI_HOST_PROFILE: env.AI_HOST_PROFILE,
    AI_HOST_REAL_BASE_URL: env.AI_HOST_REAL_BASE_URL,
    AI_HOST_LOCAL_BASE_URL: env.AI_HOST_LOCAL_BASE_URL,
    AI_HOST_REAL_DEFAULT_MODEL: env.AI_HOST_REAL_DEFAULT_MODEL,
    AI_HOST_LOCAL_DEFAULT_MODEL: env.AI_HOST_LOCAL_DEFAULT_MODEL,
    AI_MODEL_POLICY_PROFILE: env.AI_MODEL_POLICY_PROFILE,
    AI_MODEL_REAL_EXTRACTION: env.AI_MODEL_REAL_EXTRACTION,
    AI_MODEL_REAL_CLASSIFICATION: env.AI_MODEL_REAL_CLASSIFICATION,
    AI_MODEL_REAL_EMBEDDINGS: env.AI_MODEL_REAL_EMBEDDINGS,
    AI_MODEL_REAL_RERANKING: env.AI_MODEL_REAL_RERANKING,
    AI_MODEL_REAL_EDITORIAL_REVIEW: env.AI_MODEL_REAL_EDITORIAL_REVIEW,
    AI_MODEL_REAL_PUBLIC_SUMMARY: env.AI_MODEL_REAL_PUBLIC_SUMMARY,
    AI_MODEL_LOCAL_TEST_EXTRACTION: env.AI_MODEL_LOCAL_TEST_EXTRACTION,
    AI_MODEL_LOCAL_TEST_CLASSIFICATION: env.AI_MODEL_LOCAL_TEST_CLASSIFICATION,
    AI_MODEL_LOCAL_TEST_EMBEDDINGS: env.AI_MODEL_LOCAL_TEST_EMBEDDINGS,
    AI_MODEL_LOCAL_TEST_RERANKING: env.AI_MODEL_LOCAL_TEST_RERANKING,
    AI_MODEL_LOCAL_TEST_EDITORIAL_REVIEW:
      env.AI_MODEL_LOCAL_TEST_EDITORIAL_REVIEW,
    AI_MODEL_LOCAL_TEST_PUBLIC_SUMMARY: env.AI_MODEL_LOCAL_TEST_PUBLIC_SUMMARY,
    NEXT_PUBLIC_CONVEX_URL: env.NEXT_PUBLIC_CONVEX_URL,
    INTERNAL_SERVICE_TOKEN: env.INTERNAL_SERVICE_TOKEN,
  };
}

const makeRuntimeAppLayer = (env: ServerEnv) => {
  const appLayer = makeAppLayer(env);
  const structuredAiLayer = StructuredAiLive(resolveModelPolicy(env)).pipe(
    Layer.provide(appLayer),
  );
  return Layer.mergeAll(appLayer, structuredAiLayer);
};

type CachedHandler = (
  request: Request,
  context: Context.Context<unknown>,
) => Promise<Response>;

const handlerCache = new WeakMap<Env, Promise<CachedHandler>>();
const requestContext = Context.add(
  Context.empty(),
  NewsRepository,
  makeFixtureRepository(),
) as Context.Context<unknown>;

const getHandler = (env: Env) => {
  const cached = handlerCache.get(env);
  if (cached) return cached;

  const next = Effect.runPromise(
    Effect.gen(function* () {
      const parsedEnv = yield* loadServerEnv(runtimeEnv(env));
      const repositoryLayer = env.DATABASE_URL
        ? PostgresNewsRepositoryLive(env.DATABASE_URL)
        : FixtureNewsRepositoryLive;
      const httpRoutesLayer = makeHttpRoutesLayer(env).pipe(
        Layer.provide(repositoryLayer),
      );
      const rpcRoutesLayer = makeRpcRoutesLayer(env).pipe(
        Layer.provide(repositoryLayer),
      );
      const appLayer = Layer.mergeAll(httpRoutesLayer, rpcRoutesLayer).pipe(
        Layer.provideMerge(makeRuntimeAppLayer(parsedEnv)),
      );

      return HttpRouter.toWebHandler(appLayer, {
        routerConfig: { ignoreTrailingSlash: true },
      }).handler;
    }),
  );

  handlerCache.set(env, next);
  return next;
};

const toErrorResponse = (error: unknown) =>
  new Response(
    JSON.stringify(
      {
        error: "bad_request",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      null,
      2,
    ),
    {
      status: 400,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    },
  );

export default {
  fetch(request: Request, env: Env) {
    return getHandler(env)
      .then((handler) => handler(request, requestContext))
      .catch(toErrorResponse);
  },
  queue(batch: MessageBatch<WorkerQueueMessage>, env: Env) {
    return Effect.runPromise(
      Effect.gen(function* () {
        const parsedEnv = yield* loadServerEnv(runtimeEnv(env)).pipe(
          Effect.mapError(
            (cause) =>
              new ApiRequestError({
                message: "Failed to load runtime env for queue processing",
                cause,
              }),
          ),
        );

        return yield* Effect.forEach(batch.messages, (message) => {
          const body = message.body;

          if (body.type === "ai_result") {
            if (!env.DATABASE_URL) {
              return Effect.fail(
                new ApiRequestError({
                  message: "DATABASE_URL is required for AI result handling",
                }),
              );
            }

            return Effect.gen(function* () {
              const outcome = yield* persistAiResultToCanonicalStore(
                env.DATABASE_URL as string,
                body.result,
              );
              if (outcome.rebuildStories) {
                yield* rebuildStoriesAndQueueAiJobs(
                  env.DATABASE_URL as string,
                  {
                    aiModelPolicy: resolveModelPolicy(parsedEnv),
                    includeClusteringSupportJobs: false,
                  },
                ).pipe(
                  Effect.catchIf(
                    () => true,
                    (error: unknown) =>
                      Effect.gen(function* () {
                        const db = createDb(env.DATABASE_URL as string);
                        yield* Effect.tryPromise({
                          try: () =>
                            appendAiJobEvent(db, {
                              jobId: body.result.job_id,
                              attemptNumber: outcome.attemptNumber,
                              level: "error",
                              eventType: "story_rebuild_failed",
                              message:
                                "AI result post-processing failed while rebuilding stories",
                              details: {
                                error:
                                  error instanceof Error
                                    ? error.message
                                    : String(error),
                              },
                            }),
                          catch: (cause) =>
                            new ApiRequestError({
                              message:
                                "Failed to append AI rebuild failure event",
                              cause,
                            }),
                        }).pipe(Effect.ignore);
                        return yield* Effect.fail(error);
                      }),
                  ),
                );
              }
              if (outcome.safetyJobPayload) {
                yield* enqueueSafetyComplianceJob(
                  env.DATABASE_URL as string,
                  outcome.safetyJobPayload,
                );
              }
              if (outcome.queueProjectionSync) {
                const queuedAt = yield* nowIso;
                yield* enqueue(env.SYNC_QUEUE, {
                  type: "sync_public_story_projections",
                  reason: "ai_result",
                  jobId: body.result.job_id,
                  queuedAt,
                });
              }
            });
          }

          if (body.type === "sync_public_story_projections") {
            return Effect.gen(function* () {
              if (!parsedEnv.DATABASE_URL) {
                return yield* new ApiRequestError({
                  message: "DATABASE_URL is required for Convex sync",
                });
              }
              if (!parsedEnv.NEXT_PUBLIC_CONVEX_URL) {
                return yield* new ApiRequestError({
                  message: "NEXT_PUBLIC_CONVEX_URL is required for Convex sync",
                });
              }

              yield* syncCanonicalStoriesToConvex({
                databaseUrl: parsedEnv.DATABASE_URL,
                convexUrl: parsedEnv.NEXT_PUBLIC_CONVEX_URL,
                serviceToken: parsedEnv.INTERNAL_SERVICE_TOKEN,
              });
              return;
            });
          }

          return Effect.void;
        }).pipe(Effect.provide(makeRuntimeAppLayer(parsedEnv)));
      }),
    );
  },
};
