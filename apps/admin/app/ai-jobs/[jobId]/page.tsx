import { Effect } from "effect";
import { notFound } from "next/navigation";
import { AdminShell } from "../../admin-shell";
import { adminRpc } from "../../rpc";
import { AiJobDetailClient } from "./ai-job-detail-client";

export default async function AiJobDetailPage(props: {
  params: Promise<{ jobId: string }>;
}) {
  const { jobId } = await props.params;
  const detail = await Effect.runPromise(
    adminRpc((rpc) => rpc.getAdminAiJobDetail(jobId)),
  );

  if (!detail) {
    notFound();
  }

  return (
    <AdminShell
      title={detail.job.type}
      subtitle="Payload, results, and event timeline for a single AI job."
      currentPath="/ai-jobs"
    >
      <AiJobDetailClient initialData={detail} jobId={jobId} />
    </AdminShell>
  );
}
