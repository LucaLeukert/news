"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useAction } from "next-safe-action/hooks";
import { useRouter } from "next/navigation";
import { useId } from "react";
import {
  enqueueCrawlAction,
  reingestFailedVerificationAction,
  syncProjectionAction,
} from "./actions";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { adminQueryKeys } from "./rpc-client";

const invalidateAdminQueries = async (
  queryClient: ReturnType<typeof useQueryClient>,
) => {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: adminQueryKeys.operations() }),
    queryClient.invalidateQueries({
      queryKey: adminQueryKeys.aiJobs({ limit: 200 }),
    }),
  ]);
};

const ActionMessage = ({
  message,
  error,
}: {
  readonly message?: string;
  readonly error?: string;
}) => {
  if (!message && !error) {
    return null;
  }

  return (
    <div
      className={
        error
          ? "rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"
          : "rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700"
      }
    >
      {error ?? message}
    </div>
  );
};

export function QueueCrawlButton(props: {
  readonly kind: "rss_checks" | "stale_story_refresh";
  readonly label: string;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { execute, result, isExecuting } = useAction(enqueueCrawlAction, {
    onSuccess: async () => {
      await invalidateAdminQueries(queryClient);
      router.refresh();
    },
  });

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        execute({ kind: props.kind });
      }}
    >
      <Button disabled={isExecuting} type="submit">
        {isExecuting ? "Queuing..." : props.label}
      </Button>
      <ActionMessage
        error={result.serverError}
        message={result.data?.message}
      />
    </form>
  );
}

export function SyncProjectionButton() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { execute, result, isExecuting } = useAction(syncProjectionAction, {
    onSuccess: async () => {
      await invalidateAdminQueries(queryClient);
      router.refresh();
    },
  });

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        execute();
      }}
    >
      <Button disabled={isExecuting} type="submit">
        {isExecuting ? "Queuing..." : "Queue Sync"}
      </Button>
      <ActionMessage
        error={result.serverError}
        message={result.data?.message}
      />
    </form>
  );
}

export function ReingestFailedVerificationForm() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const sourceDomainId = useId();
  const limitId = useId();
  const { execute, result, isExecuting } = useAction(
    reingestFailedVerificationAction,
    {
      onSuccess: async () => {
        await invalidateAdminQueries(queryClient);
        router.refresh();
      },
    },
  );

  return (
    <form
      className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]"
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        execute({
          statuses: formData
            .getAll("statuses")
            .map((value) => String(value))
            .filter((value) => value.length > 0) as Array<
            | "rss_mismatch_title"
            | "rss_mismatch_date"
            | "canonical_failed"
            | "extraction_failed"
          >,
          sourceDomain: String(formData.get("sourceDomain") ?? "").trim(),
          limit: Number(formData.get("limit") ?? "100"),
          overrideTitleMismatches:
            String(formData.get("overrideTitleMismatches") ?? "") === "on",
        });
      }}
    >
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2 text-sm font-medium text-stone-700">
          <label htmlFor={sourceDomainId}>Source Domain</label>
          <Input
            id={sourceDomainId}
            name="sourceDomain"
            placeholder="zdfheute.de"
            type="text"
          />
        </div>
        <div className="space-y-2 text-sm font-medium text-stone-700">
          <label htmlFor={limitId}>Limit</label>
          <Input
            id={limitId}
            name="limit"
            min="1"
            defaultValue="100"
            type="number"
          />
        </div>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <fieldset className="space-y-3 rounded-[24px] border border-stone-200 bg-stone-50/80 p-4">
          <legend className="px-2 text-sm font-semibold text-stone-900">
            Statuses
          </legend>
          <label className="flex items-center gap-3 text-sm text-stone-600">
            <input
              className="size-4 rounded border-stone-300"
              defaultChecked
              name="statuses"
              type="checkbox"
              value="rss_mismatch_title"
            />
            RSS title mismatch
          </label>
          <label className="flex items-center gap-3 text-sm text-stone-600">
            <input
              className="size-4 rounded border-stone-300"
              defaultChecked
              name="statuses"
              type="checkbox"
              value="rss_mismatch_date"
            />
            RSS date mismatch
          </label>
          <label className="flex items-center gap-3 text-sm text-stone-600">
            <input
              className="size-4 rounded border-stone-300"
              name="statuses"
              type="checkbox"
              value="canonical_failed"
            />
            Canonical fetch failed
          </label>
          <label className="flex items-center gap-3 text-sm text-stone-600">
            <input
              className="size-4 rounded border-stone-300"
              name="statuses"
              type="checkbox"
              value="extraction_failed"
            />
            Extraction failed
          </label>
        </fieldset>
        <fieldset className="space-y-3 rounded-[24px] border border-stone-200 bg-stone-50/80 p-4">
          <legend className="px-2 text-sm font-semibold text-stone-900">
            Manual Override
          </legend>
          <label className="flex items-start gap-3 text-sm leading-6 text-stone-600">
            <input
              className="mt-1 size-4 rounded border-stone-300"
              name="overrideTitleMismatches"
              type="checkbox"
              value="on"
            />
            Promote persistent title mismatches to verified after reingest.
          </label>
        </fieldset>
      </div>
      <div className="space-y-4 xl:col-span-2">
        <Button disabled={isExecuting} type="submit">
          {isExecuting ? "Reingesting..." : "Reingest Failed Articles"}
        </Button>
        <ActionMessage
          error={result.serverError}
          message={result.data?.message}
        />
      </div>
    </form>
  );
}
