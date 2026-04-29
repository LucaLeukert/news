import { AdminShell } from "../admin-shell";
import { Badge } from "../components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { EnqueueForm } from "./enqueue-form";

export default async function EnqueuePage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const searchParams =
    (await props.searchParams) ??
    ({} as Record<string, string | string[] | undefined>);
  const notice =
    typeof searchParams.notice === "string" ? searchParams.notice : null;

  return (
    <AdminShell
      title="Article Enqueue"
      subtitle="Fetch canonical pages directly and push them through the AI and story pipeline."
      notice={notice}
      currentPath="/enqueue"
    >
      <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader>
            <Badge variant="muted" className="w-fit">
              Direct Intake
            </Badge>
            <CardTitle>Fetch canonical pages from raw links</CardTitle>
            <CardDescription>
              One URL per line. This path fetches the article immediately
              instead of dropping a dead crawl-queue message.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <EnqueueForm />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <Badge variant="muted" className="w-fit">
              Flow
            </Badge>
            <CardTitle>What happens after submit</CardTitle>
            <CardDescription>
              The page now uses the real intake path instead of the old broken
              admin enqueue flow.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm leading-6 text-stone-600">
            <p>Fetch and canonicalize the article immediately.</p>
            <p>Persist metadata and update crawl state.</p>
            <p>Queue article and source AI jobs where needed.</p>
            <p>
              Rebuild stories so the result is visible without manual cleanup.
            </p>
          </CardContent>
        </Card>
      </section>
    </AdminShell>
  );
}
