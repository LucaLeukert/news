import { createEnv } from "@t3-oss/env-core";
import { defineConfig } from "drizzle-kit";
import { z } from "zod";

const runtimeEnv = globalThis.process.env;

const env = createEnv({
  server: {
    DATABASE_URL: z
      .string()
      .url()
      .default("postgres://postgres:postgres@localhost:5432/news"),
  },
  runtimeEnv: {
    DATABASE_URL: runtimeEnv.DATABASE_URL,
  },
  emptyStringAsUndefined: true,
});

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: env.DATABASE_URL,
  },
  strict: true,
  verbose: true,
});
