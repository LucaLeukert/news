"use server";

import { Effect } from "effect";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { adminRpc } from "./rpc";
import { actionClient } from "./safe-action";

const crawlKindSchema = z.enum(["rss_checks", "stale_story_refresh"]);
const reingestStatusSchema = z.enum([
  "rss_mismatch_title",
  "rss_mismatch_date",
  "canonical_failed",
  "extraction_failed",
]);

const normalizeOptionalString = (value: string | undefined) => {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
};

const revalidateAdminViews = () => {
  revalidatePath("/");
  revalidatePath("/ai-jobs");
  revalidatePath("/enqueue");
};

export const enqueueCrawlAction = actionClient
  .inputSchema(
    z.object({
      kind: crawlKindSchema,
    }),
  )
  .action(async ({ parsedInput }) => {
    await Effect.runPromise(
      adminRpc((rpc) =>
        rpc.enqueueCrawl({
          kind: parsedInput.kind,
          scheduledAt: new Date().toISOString(),
        }),
      ),
    );

    revalidateAdminViews();

    return {
      message: `Queued ${parsedInput.kind}.`,
    };
  });

export const syncProjectionAction = actionClient.action(async () => {
  await Effect.runPromise(
    adminRpc((rpc) => rpc.syncPublicStoryProjections({ reason: "admin" })),
  );

  revalidateAdminViews();

  return {
    message: "Queued projection sync.",
  };
});

export const enqueueArticleUrlsAction = actionClient
  .inputSchema(
    z.object({
      urls: z.array(z.string().url()).min(1),
    }),
  )
  .action(async ({ parsedInput }) => {
    const result = await Effect.runPromise(
      adminRpc((rpc) =>
        rpc.manualArticleIntake({
          urls: parsedInput.urls,
        }),
      ),
    );

    revalidateAdminViews();

    return {
      message: `Processed ${result.processed.length} URL(s), failed ${result.failures.length}, queued ${result.articleAiJobCount + result.sourceAiJobCount} AI jobs, rebuilt ${result.storyCount} stories.`,
    };
  });

export const reingestFailedVerificationAction = actionClient
  .inputSchema(
    z.object({
      statuses: z.array(reingestStatusSchema).min(1),
      sourceDomain: z.string().optional(),
      limit: z.number().int().positive(),
      overrideTitleMismatches: z.boolean(),
    }),
  )
  .action(async ({ parsedInput }) => {
    const result = await Effect.runPromise(
      adminRpc((rpc) =>
        rpc.reingestFailedVerification({
          statuses: parsedInput.statuses,
          sourceDomain: normalizeOptionalString(parsedInput.sourceDomain),
          limit: parsedInput.limit,
          overrideTitleMismatches: parsedInput.overrideTitleMismatches,
        }),
      ),
    );

    revalidateAdminViews();

    return {
      message: `Reingested ${result.processedCount} articles, reverified ${result.reverifiedCount}, queued ${result.articleAiJobCount + result.sourceAiJobCount} AI jobs, rebuilt ${result.storyCount} stories.`,
    };
  });
