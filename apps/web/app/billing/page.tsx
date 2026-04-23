import { auth } from "@clerk/nextjs/server";
import { Effect } from "effect";
import { env } from "../../env";

export default async function BillingPage() {
  const { userId } = await Effect.runPromise(
    Effect.tryPromise(() => auth()).pipe(
      Effect.catchIf(
        () => true,
        () => Effect.succeed({ userId: null }),
      ),
    ),
  );

  return (
    <main className="shell">
      <header className="story-heading">
        <h1>Billing</h1>
        <p>
          Clerk owns authentication and billing identity. Application data keeps
          only Clerk IDs and plan state projections.
        </p>
      </header>
      <section className="side-panel">
        <h2>Current Access</h2>
        <p>
          {userId ? `Signed in as ${userId}` : "Sign in to manage billing."}
        </p>
        <p>
          {env.CLERK_PRICE_ID_PRO
            ? "Pro checkout is configured through Clerk Billing."
            : "No Clerk Billing price is configured in this environment."}
        </p>
      </section>
    </main>
  );
}
