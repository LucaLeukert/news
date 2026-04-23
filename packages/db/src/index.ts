import { createEnv } from "@t3-oss/env-core";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { z } from "zod";
import * as schema from "./schema";

export * from "./schema";

const runtimeEnv = globalThis.process.env;

export function createDb(databaseUrl = runtimeEnv.DATABASE_URL) {
  const env = createEnv({
    server: {
      DATABASE_URL: z.string().url(),
    },
    runtimeEnv: {
      DATABASE_URL: databaseUrl,
    },
    emptyStringAsUndefined: true,
  });

  const client = postgres(env.DATABASE_URL, {
    prepare: false,
    max: 10,
  });

  return drizzle(client, { schema });
}
