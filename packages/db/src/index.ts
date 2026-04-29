import { neon } from "@neondatabase/serverless";
import { makeDbEnv } from "@news/env";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

export * from "./schema";
export * from "./ai-job-events";

export function createDb(databaseUrl: string) {
  const env = makeDbEnv({
    DATABASE_URL: databaseUrl,
  });

  const client = neon(env.DATABASE_URL);

  return drizzle(client, { schema });
}
