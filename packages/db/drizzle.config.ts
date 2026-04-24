import { makeDrizzleEnv } from "@news/env";
import { defineConfig } from "drizzle-kit";

const runtimeEnv = typeof process !== "undefined" ? process.env : {};

const env = makeDrizzleEnv({
  DATABASE_URL: runtimeEnv.DATABASE_URL,
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
