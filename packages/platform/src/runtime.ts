import type { ServerEnv } from "@news/env";
import { Effect, Layer, Logger } from "effect";
import { AiGatewayLive } from "./ai-gateway";
import { AuthLive, BillingLive } from "./auth";
import { HttpLive } from "./http";
import { MetricsLive } from "./metrics";

export const makeAppLayer = (env: ServerEnv) =>
  Layer.mergeAll(
    MetricsLive,
    HttpLive,
    AiGatewayLive(env),
    AuthLive(env),
    BillingLive(env),
    Logger.layer([Logger.consolePretty()]),
  );

export const runMain = <A, E>(effect: Effect.Effect<A, E, never>) =>
  Effect.runPromise(effect);

export const withAppLayer = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  env: ServerEnv,
): Effect.Effect<A, E, Exclude<R, never>> =>
  effect.pipe(Effect.provide(makeAppLayer(env))) as never;
