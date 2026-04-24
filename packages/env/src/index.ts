import { createEnv } from "@t3-oss/env-core";
import { Data, Effect } from "effect";
import { z } from "zod";

const boolish = z
  .enum(["true", "false", "1", "0"])
  .optional()
  .transform((value) => value === "true" || value === "1");

const nodeEnvSchema = z
  .enum(["development", "test", "production"])
  .default("development");

const databaseUrlSchema = z.string().url();
const publicConvexUrlSchema = z.string().url().optional();
const publicApiBaseUrlSchema = z.string().url().default("http://localhost:8787");
const publicClerkPublishableKeySchema = z.string().optional();

const localDatabaseUrlSchema = databaseUrlSchema.default(
  "postgres://postgres:postgres@localhost:5432/news",
);

export const serverOnlyEnvSchema = {
  NODE_ENV: nodeEnvSchema,
  DATABASE_URL: databaseUrlSchema.optional(),
  R2_BUCKET: z.string().default("crawl-artifacts"),
  CONVEX_DEPLOYMENT: z.string().optional(),
  CONVEX_URL: z.string().url().optional(),
  CONVEX_SITE_URL: z.string().url().optional(),
  CLOUDFLARE_ACCOUNT_ID: z.string().optional(),
  CLOUDFLARE_ACCESS_AUD: z.string().optional(),
  CLOUDFLARE_ACCESS_SERVICE_TOKEN_ID: z.string().optional(),
  CLOUDFLARE_ACCESS_SERVICE_TOKEN_SECRET: z.string().optional(),
  INTERNAL_SERVICE_TOKEN: z.string().default("local-dev"),
  CLERK_SECRET_KEY: z.string().optional(),
  CLERK_WEBHOOK_SECRET: z.string().optional(),
  CLERK_PRICE_ID_PRO: z.string().optional(),
  LOCAL_MODEL_BASE_URL: z.string().url().default("http://localhost:1234/v1"),
  LOCAL_MODEL_NAME: z.string().default("gpt-oss-20b"),
  AI_RUNNER_NODE_ID: z.string().default("local-dev"),
  AI_RUNNER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(3000),
  EFFECT_DEVTOOLS: boolish,
} as const;

export const clientEnvSchema = {
  NEXT_PUBLIC_CONVEX_URL: publicConvexUrlSchema,
  NEXT_PUBLIC_API_BASE_URL: publicApiBaseUrlSchema,
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: publicClerkPublishableKeySchema,
} as const;

export const serverEnvSchema = {
  ...serverOnlyEnvSchema,
  ...clientEnvSchema,
} as const;

export class ConfigError extends Data.TaggedError("ConfigError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export function makeServerEnv(runtimeEnv: Record<string, string | undefined>) {
  return createEnv({
    server: serverEnvSchema,
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

export const makeDbEnv = (runtimeEnv: Record<string, string | undefined>) =>
  createEnv({
    server: {
      DATABASE_URL: databaseUrlSchema,
    },
    runtimeEnv,
    emptyStringAsUndefined: true,
  });

export const makeDrizzleEnv = (runtimeEnv: Record<string, string | undefined>) =>
  createEnv({
    server: {
      DATABASE_URL: localDatabaseUrlSchema,
    },
    runtimeEnv,
    emptyStringAsUndefined: true,
  });

export type DbEnv = ReturnType<typeof makeDbEnv>;
export type DrizzleEnv = ReturnType<typeof makeDrizzleEnv>;
