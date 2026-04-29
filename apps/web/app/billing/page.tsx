import { auth } from "@clerk/nextjs/server";
import { Effect } from "effect";
import Link from "next/link";
import { env } from "../../env";
import { Badge } from "../components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card";

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
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(249,115,22,0.14),_transparent_26%),linear-gradient(180deg,_#fafaf9_0%,_#f5f5f4_100%)]">
      <div className="mx-auto flex min-h-screen w-full max-w-4xl flex-col px-4 py-6 lg:px-6">
        <Card>
          <CardHeader>
            <Badge variant="muted" className="w-fit">
              Billing
            </Badge>
            <CardTitle className="font-serif text-4xl">
              Account access and billing state
            </CardTitle>
            <CardDescription className="max-w-2xl leading-7">
              Clerk owns authentication and billing identity. Application data
              keeps only Clerk IDs and plan state projections.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm leading-6 text-stone-600">
            <p>
              {userId ? `Signed in as ${userId}` : "Sign in to manage billing."}
            </p>
            <p>
              {env.CLERK_PRICE_ID_PRO
                ? "Pro checkout is configured through Clerk Billing."
                : "No Clerk Billing price is configured in this environment."}
            </p>
            <Link
              href="/"
              className="font-medium text-stone-950 underline-offset-4 hover:underline"
            >
              Return to stories
            </Link>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
