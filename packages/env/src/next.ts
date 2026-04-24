import { createEnv } from "@t3-oss/env-nextjs";
import { clientEnvSchema, serverOnlyEnvSchema } from "./index";

const runtimeEnv: Record<string, string | undefined> =
  typeof process === "undefined" ? {} : process["env"];

export const env = createEnv({
  server: serverOnlyEnvSchema,
  client: clientEnvSchema,
  experimental__runtimeEnv: {
    NEXT_PUBLIC_CONVEX_URL: runtimeEnv.NEXT_PUBLIC_CONVEX_URL,
    NEXT_PUBLIC_API_BASE_URL: runtimeEnv.NEXT_PUBLIC_API_BASE_URL,
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:
      runtimeEnv.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  },
  emptyStringAsUndefined: true,
});
