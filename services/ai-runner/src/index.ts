import {
  StructuredAiLive,
  aiSchemasByJobType,
  featureForAiJobType,
  generateStructuredJson,
  modelForAiJobType,
  storySummaryPrompt,
} from "@news/ai";
import {
  MetricsService,
  NewsRpcClient,
  NewsRpcClientLive,
  type ServerEnv,
  loadServerEnv,
  makeAppLayer,
  runMain,
} from "@news/platform";
import {
  type LeasedAiJob,
  aiResultEnvelopeSchema,
  decodeUnknownSync,
} from "@news/types";
import { Clock, DateTime, Effect, Layer, Schedule } from "effect";

const decodeAiResultEnvelope = decodeUnknownSync(aiResultEnvelopeSchema);

const apiBaseFromEnv = (env: ServerEnv) => env.NEXT_PUBLIC_API_BASE_URL;
const serviceTokenFromEnv = (env: ServerEnv) =>
  env.CLOUDFLARE_ACCESS_SERVICE_TOKEN_SECRET;

const leaseJob = (nodeId: string) =>
  Effect.gen(function* () {
    const rpc = yield* NewsRpcClient;
    return yield* rpc.leaseAiJob(nodeId);
  });

const promptFor = (job: LeasedAiJob) =>
  storySummaryPrompt({
    storyTitle: job.payload.storyTitle,
    articles: job.payload.articles,
  });

const completeJob = (env: ServerEnv, job: LeasedAiJob) =>
  Effect.gen(function* () {
    const rpc = yield* NewsRpcClient;
    const metrics = yield* MetricsService;
    const schema = aiSchemasByJobType[job.type];
    const modelFeature = featureForAiJobType(job.type);
    const model = modelForAiJobType(job.type);
    const started = yield* Clock.currentTimeMillis;
    const output = yield* generateStructuredJson({
      prompt: promptFor(job),
      schema,
      feature: modelFeature,
    });

    const confidence = output.confidence;

    const envelope = decodeAiResultEnvelope({
      job_id: job.id,
      model_name: model,
      model_version: model,
      prompt_version: `${job.type}@2026-04-22`,
      input_artifact_ids: job.inputArtifactIds,
      output_schema_version: "1",
      structured_output: output,
      confidence,
      reasons: "reasons" in output ? output.reasons : [],
      citations_to_input_ids: job.inputArtifactIds,
      validation_status: "valid",
      created_at: yield* DateTime.now.pipe(Effect.map(DateTime.formatIso)),
      latency_ms: (yield* Clock.currentTimeMillis) - started,
    });

    yield* metrics.gauge("ai.job_latency_ms", envelope.latency_ms, {
      jobType: job.type,
      modelFeature,
      model,
    });

    yield* rpc.submitAiJobResult(envelope);
  }).pipe(
    Effect.catchIf(
      () => true,
      (error: unknown) =>
        Effect.gen(function* () {
          const metrics = yield* MetricsService;
          yield* metrics.increment("ai.schema_failure", { jobType: job.type });
          yield* Effect.logWarning("ai_runner.job.failed", {
            jobId: job.id,
            error,
          });
        }),
    ),
  );

const pollOnce = (env: ServerEnv, nodeId: string) =>
  Effect.gen(function* () {
    const metrics = yield* MetricsService;
    yield* metrics.increment("ai.runner_uptime", { nodeId });
    const job = yield* leaseJob(nodeId).pipe(
      Effect.catchIf(
        () => true,
        (error: unknown) =>
          Effect.gen(function* () {
            yield* Effect.logWarning("ai_runner.lease.failed", error);
            return null;
          }),
      ),
    );
    if (job) {
      yield* Effect.logInfo("ai_runner.job.leased", {
        jobId: job.id,
        type: job.type,
        modelFeature: featureForAiJobType(job.type),
        model: modelForAiJobType(job.type),
      });
      yield* completeJob(env, job);
    }
  });

const main = (env: ServerEnv) =>
  Effect.gen(function* () {
    yield* Effect.logInfo("ai_runner.started", {
      nodeId: env.AI_RUNNER_NODE_ID,
      apiBase: apiBaseFromEnv(env),
    });
    yield* pollOnce(env, env.AI_RUNNER_NODE_ID).pipe(
      Effect.repeat(Schedule.fixed(`${env.AI_RUNNER_POLL_INTERVAL_MS} millis`)),
    );
  });

if (import.meta.main) {
  const env = await Effect.runPromise(loadServerEnv(process.env));
  const appLayer = Layer.merge(
    StructuredAiLive.pipe(Layer.provideMerge(makeAppLayer(env))),
    NewsRpcClientLive({
      apiBaseUrl: apiBaseFromEnv(env),
      serviceToken: serviceTokenFromEnv(env),
    }),
  );
  await runMain(main(env).pipe(Effect.provide(appLayer)));
}
