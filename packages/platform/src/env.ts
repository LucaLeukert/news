import { createEnv } from "@t3-oss/env-core";
import { Effect } from "effect";
import { z } from "zod";
import { ConfigError } from "./errors";

const boolish = z
  .enum(["true", "false", "1", "0"])
  .optional()
  .transform((value) => value === "true" || value === "1");

export const baseServerEnvSchema = {
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  DATABASE_URL: z.string().url().optional(),
  R2_BUCKET: z.string().default("crawl-artifacts"),
  CONVEX_DEPLOYMENT: z.string().optional(),
  NEXT_PUBLIC_API_BASE_URL: z.string().url().default("http://localhost:8787"),
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z.string().optional(),
  CLERK_SECRET_KEY: z.string().optional(),
  CLERK_WEBHOOK_SECRET: z.string().optional(),
  CLERK_PRICE_ID_PRO: z.string().optional(),
  LOCAL_MODEL_BASE_URL: z.string().url().default("http://localhost:1234/v1"),
  LOCAL_MODEL_NAME: z.string().default("gpt-oss-20b"),
  CLOUDFLARE_ACCESS_SERVICE_TOKEN_SECRET: z.string().default("local-dev"),
  AI_RUNNER_NODE_ID: z.string().default("local-dev"),
  AI_RUNNER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(3000),
  EFFECT_DEVTOOLS: boolish,
} as const;

export function makeServerEnv(runtimeEnv: Record<string, string | undefined>) {
  return createEnv({
    server: baseServerEnvSchema,
    runtimeEnv,
    emptyStringAsUndefined: true,
  });
}

export type ServerEnv = ReturnType<typeof makeServerEnv>;

export const loadServerEnv = (runtimeEnv: Record<string, string | undefined>) =>
  Effect.try({
    try: () => makeServerEnv(runtimeEnv),
    catch: (cause) =>
      new ConfigError({ message: "Invalid environment", cause }),
  });
