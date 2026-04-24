import { createClerkClient } from "@clerk/backend";
import type { ServerEnv } from "@news/env";
import { Context, Effect, Layer } from "effect";
import { AuthError, type BillingError } from "./errors";

export type AuthIdentity = {
  readonly userId: string | null;
  readonly orgId: string | null;
  readonly sessionId: string | null;
};

export interface AuthServiceShape {
  readonly getIdentityFromRequest: (
    request: Request,
  ) => Effect.Effect<AuthIdentity, AuthError>;
}

export interface BillingServiceShape {
  readonly getBillingPortalUrl: (
    userId: string,
  ) => Effect.Effect<string | null, BillingError>;
  readonly getDefaultPlan: () => Effect.Effect<"free" | "pro">;
}

export class AuthService extends Context.Service<
  AuthService,
  AuthServiceShape
>()("@news/platform/AuthService") {}
export class BillingService extends Context.Service<
  BillingService,
  BillingServiceShape
>()("@news/platform/BillingService") {}

export const AuthLive = (env: Pick<ServerEnv, "CLERK_SECRET_KEY">) =>
  Layer.succeed(AuthService, {
    getIdentityFromRequest: (request: Request) =>
      Effect.tryPromise({
        try: () => {
          if (!env.CLERK_SECRET_KEY) {
            return Promise.resolve({
              userId: null,
              orgId: null,
              sessionId: null,
            });
          }
          const clerk = createClerkClient({ secretKey: env.CLERK_SECRET_KEY });
          return clerk.authenticateRequest(request).then((auth) => {
            const payload = auth.toAuth();
            if (!payload) return { userId: null, orgId: null, sessionId: null };
            return {
              userId: payload.userId ?? null,
              orgId: payload.orgId ?? null,
              sessionId: payload.sessionId ?? null,
            };
          });
        },
        catch: (cause) =>
          new AuthError({
            message: "Clerk request authentication failed",
            cause,
          }),
      }),
  });

export const BillingLive = (env: Pick<ServerEnv, "CLERK_PRICE_ID_PRO">) =>
  Layer.succeed(BillingService, {
    getBillingPortalUrl: (userId: string) =>
      Effect.gen(function* () {
        yield* Effect.logInfo("billing.portal.requested", { userId });
        return null;
      }),
    getDefaultPlan: () =>
      Effect.succeed(env.CLERK_PRICE_ID_PRO ? "pro" : "free"),
  });
