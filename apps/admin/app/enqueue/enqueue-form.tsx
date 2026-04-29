"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useAction } from "next-safe-action/hooks";
import { useRouter } from "next/navigation";
import { useId } from "react";
import { enqueueArticleUrlsAction } from "../actions";
import { Button } from "../components/ui/button";
import { Textarea } from "../components/ui/textarea";
import { adminQueryKeys } from "../rpc-client";

export function EnqueueForm() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const textareaId = useId();
  const { execute, result, isExecuting } = useAction(enqueueArticleUrlsAction, {
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: adminQueryKeys.operations(),
        }),
        queryClient.invalidateQueries({
          queryKey: adminQueryKeys.aiJobs({ limit: 200 }),
        }),
      ]);
      router.refresh();
    },
  });

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        const rawUrls = new FormData(event.currentTarget)
          .get("urls")
          ?.toString()
          .split(/\r?\n/)
          .map((value) => value.trim())
          .filter((value) => value.length > 0);

        execute({
          urls: rawUrls ?? [],
        });
      }}
    >
      <div className="space-y-2 text-sm font-medium text-stone-700">
        <label htmlFor={textareaId}>Article URLs</label>
        <Textarea
          id={textareaId}
          name="urls"
          placeholder={
            "https://www.tagesschau.de/wirtschaft/...\nhttps://example.com/news/story"
          }
          required
          rows={10}
        />
      </div>
      <Button disabled={isExecuting} type="submit">
        {isExecuting ? "Fetching..." : "Fetch And Enqueue"}
      </Button>
      {result.serverError ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {result.serverError}
        </div>
      ) : null}
      {result.data?.message ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {result.data.message}
        </div>
      ) : null}
    </form>
  );
}
