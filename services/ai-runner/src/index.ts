import {
  PROMPT_VERSIONS,
  StructuredAiLive,
  aiSchemasByJobType,
  articleExtractionQaPrompt,
  biasContextPrompt,
  claimExtractionPrompt,
  factualityReliabilityPrompt,
  featureForAiJobType,
  generateStructuredJson,
  modelForAiJobType,
  modelSequence,
  ownershipExtractionPrompt,
  resolveModelPolicy,
  safetyCompliancePrompt,
  sanitizeStructuredOutput,
  storyClusteringSupportPrompt,
  storySummaryPrompt,
  validationReasonsForStructuredOutput,
  validationStatusForStructuredOutput,
} from "@news/ai";
import { type ServerEnv, loadServerEnv } from "@news/env";
import {
  MetricsService,
  NewsRpcClient,
  NewsRpcClientLive,
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
  env.CLOUDFLARE_ACCESS_SERVICE_TOKEN_SECRET ?? env.INTERNAL_SERVICE_TOKEN;

const leaseJob = (nodeId: string, model?: string) =>
  Effect.gen(function* () {
    const rpc = yield* NewsRpcClient;
    return yield* rpc.leaseAiJob({ nodeId, model });
  });

const leaseBatch = (nodeId: string, model: string, maxJobs: number) =>
  Effect.gen(function* () {
    const jobs: LeasedAiJob[] = [];
    for (let index = 0; index < maxJobs; index += 1) {
      const job = yield* leaseJob(nodeId, model).pipe(
        Effect.catchIf(
          () => true,
          (error: unknown) =>
            Effect.gen(function* () {
              yield* Effect.logWarning("ai_runner.lease.failed", {
                model,
                error,
              });
              return null;
            }),
        ),
      );
      if (!job) {
        break;
      }
      jobs.push(job);
    }
    return jobs;
  });

const promptFor = (job: LeasedAiJob) =>
  (() => {
    switch (job.type) {
      case "article_extraction_qa":
        return articleExtractionQaPrompt({ article: job.payload.article });
      case "claim_extraction":
        return claimExtractionPrompt({ article: job.payload.article });
      case "story_clustering_support":
        return storyClusteringSupportPrompt({
          storyTitle: job.payload.storyTitle,
          articles: job.payload.articles,
        });
      case "neutral_story_summary":
        return storySummaryPrompt({
          storyTitle: job.payload.storyTitle,
          articles: job.payload.articles,
        });
      case "bias_context_classification":
        return biasContextPrompt({ source: job.payload });
      case "factuality_reliability_support":
        return factualityReliabilityPrompt({ source: job.payload });
      case "ownership_extraction_support":
        return ownershipExtractionPrompt({ source: job.payload });
      case "safety_compliance_check":
        return safetyCompliancePrompt({
          storyTitle: job.payload.storyTitle,
          summary: job.payload.summary,
          articles: job.payload.articles,
        });
    }
  })();

const promptVersionFor = (job: LeasedAiJob) => {
  switch (job.type) {
    case "article_extraction_qa":
      return PROMPT_VERSIONS.articleExtractionQa;
    case "claim_extraction":
      return PROMPT_VERSIONS.claimExtraction;
    case "story_clustering_support":
      return PROMPT_VERSIONS.storyClusteringSupport;
    case "neutral_story_summary":
      return PROMPT_VERSIONS.storySummary;
    case "bias_context_classification":
      return PROMPT_VERSIONS.biasContext;
    case "factuality_reliability_support":
      return PROMPT_VERSIONS.factualityReliability;
    case "ownership_extraction_support":
      return PROMPT_VERSIONS.ownershipExtraction;
    case "safety_compliance_check":
      return PROMPT_VERSIONS.safetyCompliance;
  }
};

const completeJob = (env: ServerEnv, job: LeasedAiJob) =>
  Effect.gen(function* () {
    const rpc = yield* NewsRpcClient;
    const metrics = yield* MetricsService;
    const activeModelPolicy = resolveModelPolicy(env);
    const schema = aiSchemasByJobType[job.type];
    const modelFeature = featureForAiJobType(job.type);
    const model = modelForAiJobType(job.type, activeModelPolicy);
    const started = yield* Clock.currentTimeMillis;
    const rawOutput = yield* generateStructuredJson({
      prompt: promptFor(job),
      schema,
      feature: modelFeature,
      model,
    });
    const output = sanitizeStructuredOutput(job.type, rawOutput);
    const validationStatus = validationStatusForStructuredOutput(
      job.type,
      output,
    );

    const confidence = output.confidence;

    const envelope = decodeAiResultEnvelope({
      job_id: job.id,
      model_name: model,
      model_version: model,
      prompt_version: promptVersionFor(job),
      input_artifact_ids: job.inputArtifactIds,
      output_schema_version: "1",
      structured_output: output,
      confidence,
      reasons: validationReasonsForStructuredOutput(job.type, output),
      citations_to_input_ids: job.inputArtifactIds,
      validation_status: validationStatus,
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
          const rpc = yield* NewsRpcClient;
          const metrics = yield* MetricsService;
          const message =
            error instanceof Error
              ? error.message
              : typeof error === "string"
                ? error
                : "unknown runner failure";
          yield* metrics.increment("ai.schema_failure", { jobType: job.type });
          yield* rpc
            .failAiJob({
              jobId: job.id,
              error: `runner_failure:${message.slice(0, 3900)}`,
            })
            .pipe(
              Effect.catchIf(
                () => true,
                (rpcError: unknown) =>
                  Effect.logWarning("ai_runner.job.fail_submission_failed", {
                    jobId: job.id,
                    rpcError,
                  }),
              ),
            );
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
    const activeModelPolicy = resolveModelPolicy(env);
    yield* metrics.increment("ai.runner_uptime", { nodeId });
    for (const model of modelSequence(activeModelPolicy)) {
      const jobs = yield* leaseBatch(
        nodeId,
        model,
        env.AI_RUNNER_MAX_BATCH_PER_MODEL,
      );
      if (jobs.length === 0) {
        continue;
      }
      yield* Effect.logInfo("ai_runner.batch.leased", {
        model,
        count: jobs.length,
      });
      yield* Effect.forEach(
        jobs,
        (job) =>
          Effect.gen(function* () {
            yield* Effect.logInfo("ai_runner.job.leased", {
              jobId: job.id,
              type: job.type,
              modelFeature: featureForAiJobType(job.type),
              model,
            });
            yield* completeJob(env, job);
          }),
        { concurrency: Math.min(jobs.length, 2) },
      );
    }
  });

const main = (env: ServerEnv) =>
  Effect.gen(function* () {
    const activeModelPolicy = resolveModelPolicy(env);
    yield* Effect.logInfo("ai_runner.started", {
      nodeId: env.AI_RUNNER_NODE_ID,
      apiBase: apiBaseFromEnv(env),
      aiHostProfile: env.AI_HOST_PROFILE,
      aiModelPolicyProfile: env.AI_MODEL_POLICY_PROFILE,
      modelSequence: modelSequence(activeModelPolicy),
    });
    yield* pollOnce(env, env.AI_RUNNER_NODE_ID).pipe(
      Effect.repeat(Schedule.fixed(`${env.AI_RUNNER_POLL_INTERVAL_MS} millis`)),
    );
  });

if (import.meta.main) {
  const env = await Effect.runPromise(loadServerEnv(process.env));
  const activeModelPolicy = resolveModelPolicy(env);
  const appLayer = Layer.merge(
    StructuredAiLive(activeModelPolicy).pipe(
      Layer.provideMerge(makeAppLayer(env)),
    ),
    NewsRpcClientLive({
      apiBaseUrl: apiBaseFromEnv(env),
      serviceToken: serviceTokenFromEnv(env),
    }),
  );
  await runMain(main(env).pipe(Effect.provide(appLayer)));
}
