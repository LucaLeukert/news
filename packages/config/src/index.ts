import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const serverEnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  R2_BUCKET: z.string().default("crawl-artifacts"),
  CONVEX_DEPLOYMENT: z.string().optional(),
  LOCAL_MODEL_BASE_URL: z.string().url().default("http://localhost:11434/v1"),
  LOCAL_MODEL_NAME: z.string().default("gpt-oss-20b"),
});

export function parseServerEnv(env: Record<string, string | undefined>) {
  return serverEnvSchema.parse(env);
}

export function createTypedEnv(runtimeEnv: Record<string, string | undefined>) {
  return createEnv({
    server: {
      DATABASE_URL: z.string().url(),
      R2_BUCKET: z.string().default("crawl-artifacts"),
      LOCAL_MODEL_BASE_URL: z
        .string()
        .url()
        .default("http://localhost:1234/v1"),
    },
    runtimeEnv,
    emptyStringAsUndefined: true,
  });
}
