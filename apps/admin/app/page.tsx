import { Effect } from "effect";
import { ArrowRight, Send, Sparkles } from "lucide-react";
import Link from "next/link";
import {
  QueueCrawlButton,
  ReingestFailedVerificationForm,
  SyncProjectionButton,
} from "./admin-actions";
import { AdminShell } from "./admin-shell";
import { Badge } from "./components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./components/ui/card";
import { OperationsDashboard } from "./operations-dashboard";
import { adminRpc } from "./rpc";

export default async function AdminHome(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [snapshot, searchParams] = await Promise.all([
    Effect.runPromise(adminRpc((rpc) => rpc.getOperationsSnapshot())),
    props.searchParams ??
      Promise.resolve({} as Record<string, string | string[] | undefined>),
  ]);

  const notice =
    typeof searchParams.notice === "string" ? searchParams.notice : null;

  return (
    <AdminShell
      title="Operations"
      subtitle="System health, story rebuild controls, and verification recovery."
      notice={notice}
      currentPath="/"
    >
      <section className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <Badge variant="muted" className="w-fit">
              Workspaces
            </Badge>
            <CardTitle>
              Focused tools instead of one overloaded console
            </CardTitle>
            <CardDescription>
              Separate high-noise operational tasks into dedicated views with
              durable logs and manual intake controls.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            <Link
              href="/ai-jobs"
              className="group rounded-[24px] border border-stone-200 bg-stone-50/80 p-5 transition hover:border-stone-300 hover:bg-white"
            >
              <div className="flex items-center justify-between">
                <Sparkles className="size-5 text-stone-500" />
                <ArrowRight className="size-4 text-stone-400 transition group-hover:translate-x-1" />
              </div>
              <div className="mt-4 space-y-2">
                <div className="text-lg font-semibold text-stone-950">
                  AI Runs
                </div>
                <p className="text-sm leading-6 text-stone-500">
                  Review queue state, grouped attempts, logs, and outputs.
                </p>
              </div>
            </Link>
            <Link
              href="/enqueue"
              className="group rounded-[24px] border border-stone-200 bg-stone-50/80 p-5 transition hover:border-stone-300 hover:bg-white"
            >
              <div className="flex items-center justify-between">
                <Send className="size-5 text-stone-500" />
                <ArrowRight className="size-4 text-stone-400 transition group-hover:translate-x-1" />
              </div>
              <div className="mt-4 space-y-2">
                <div className="text-lg font-semibold text-stone-950">
                  Article Enqueue
                </div>
                <p className="text-sm leading-6 text-stone-500">
                  Fetch one or many canonical article URLs directly.
                </p>
              </div>
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <Badge variant="muted" className="w-fit">
              Notes
            </Badge>
            <CardTitle>Operational guardrails</CardTitle>
            <CardDescription>
              Admin reads use direct typed Effect RPC through React Query. Queue
              mutations and manual recovery stay on server actions.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm leading-6 text-stone-600">
            <p>
              Overview data refreshes automatically every five seconds without a
              separate proxy endpoint in the admin app.
            </p>
            <p>
              AI run detail pages preserve every lease, retry, duplicate
              submission, and rebuild failure event for postmortem work.
            </p>
            <p>
              Direct article intake bypasses the dead crawl-queue path and
              pushes fetched articles back into clustering and AI processing.
            </p>
          </CardContent>
        </Card>
      </section>

      <section id="controls" className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-stone-950">
            Controls
          </h2>
          <p className="mt-1 text-sm text-stone-500">
            Operational actions that still belong on the overview page.
          </p>
        </div>
      </section>
      <section className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <Badge variant="muted" className="w-fit">
              Crawl
            </Badge>
            <CardTitle>RSS Check Sweep</CardTitle>
            <CardDescription>
              Queue the scheduler-style feed verification pass.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <QueueCrawlButton kind="rss_checks" label="Queue RSS Checks" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <Badge variant="muted" className="w-fit">
              Crawl
            </Badge>
            <CardTitle>Story Refresh Sweep</CardTitle>
            <CardDescription>
              Queue a stale-story refresh cycle.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <QueueCrawlButton
              kind="stale_story_refresh"
              label="Queue Refresh"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <Badge variant="muted" className="w-fit">
              Sync
            </Badge>
            <CardTitle>Projection Sync</CardTitle>
            <CardDescription>
              Push canonical public stories back into Convex.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SyncProjectionButton />
          </CardContent>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader>
            <Badge variant="muted" className="w-fit">
              Recovery
            </Badge>
            <CardTitle>Reingest Failed Verification</CardTitle>
            <CardDescription>
              Re-fetch failed verification articles, update crawl status,
              requeue AI jobs, and rebuild stories.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ReingestFailedVerificationForm />
          </CardContent>
        </Card>
      </section>

      <OperationsDashboard initialSnapshot={snapshot} />
    </AdminShell>
  );
}
