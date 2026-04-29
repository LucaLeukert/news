import { Effect } from "effect";
import { AdminShell } from "../admin-shell";
import { Badge } from "../components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { adminRpc } from "../rpc";
import { AiJobsTable } from "./ai-jobs-table";

export default async function AiJobsPage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [jobs, searchParams] = await Promise.all([
    Effect.runPromise(adminRpc((rpc) => rpc.listAdminAiJobs({ limit: 200 }))),
    props.searchParams ??
      Promise.resolve({} as Record<string, string | string[] | undefined>),
  ]);

  const notice =
    typeof searchParams.notice === "string" ? searchParams.notice : null;

  return (
    <AdminShell
      title="AI Runs"
      subtitle="Recent AI jobs with grouped-attempt detail pages and durable event logs."
      notice={notice}
      currentPath="/ai-jobs"
    >
      <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <AiJobsTable initialData={jobs} />
        <Card>
          <CardHeader>
            <Badge variant="muted" className="w-fit">
              Diagnostics
            </Badge>
            <CardTitle>What each run keeps now</CardTitle>
            <CardDescription>
              Each job page preserves a full timeline instead of collapsing
              repeated attempts into one opaque row.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm leading-6 text-stone-600">
            <p>Lease events and expirations</p>
            <p>Runner failures and duplicate result submissions</p>
            <p>Persisted structured outputs with confidence metadata</p>
            <p>Story rebuild failures triggered after AI completion</p>
          </CardContent>
        </Card>
      </section>
    </AdminShell>
  );
}
