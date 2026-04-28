"use server";

import { StructuredAiLive, resolveModelPolicy } from "@news/ai";
import { loadServerEnv } from "@news/env";
import { makeAppLayer } from "@news/platform";
import { Effect, Layer } from "effect";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { reingestFailedVerificationArticles } from "../../../services/crawler/src/reingest";
import { adminRpc } from "./rpc";

const redirectWithNotice = (message: string) =>
  redirect(`/?notice=${encodeURIComponent(message)}`);

const crawlKindFrom = (
  value: string,
): "rss_checks" | "stale_story_refresh" => {
  switch (value) {
    case "rss_checks":
    case "stale_story_refresh":
      return value;
    default:
      redirectWithNotice("Invalid crawl action.");
      throw new Error("unreachable");
  }
};

const crawlStatusesFrom = (formData: FormData) => {
  const allowed = new Set([
    "rss_mismatch_title",
    "rss_mismatch_date",
    "canonical_failed",
    "extraction_failed",
  ]);

  const statuses = formData
    .getAll("statuses")
    .map((value) => String(value))
    .filter((value) => allowed.has(value));

  if (statuses.length === 0) {
    redirectWithNotice("Select at least one verification status.");
  }

  return statuses as Array<
    | "rss_mismatch_title"
    | "rss_mismatch_date"
    | "canonical_failed"
    | "extraction_failed"
  >;
};

export async function enqueueCrawlAction(formData: FormData) {
  const kind = crawlKindFrom(String(formData.get("kind") ?? ""));

  await Effect.runPromise(
    adminRpc((rpc) =>
      rpc.enqueueCrawl({
        kind,
        scheduledAt: new Date().toISOString(),
      }),
    ),
  );

  revalidatePath("/");
  redirectWithNotice(`Queued ${kind}.`);
}

export async function syncProjectionAction() {
  await Effect.runPromise(
    adminRpc((rpc) => rpc.syncPublicStoryProjections({ reason: "admin" })),
  );

  revalidatePath("/");
  redirectWithNotice("Queued projection sync.");
}

export async function resolveUrlAction(formData: FormData) {
  const url = String(formData.get("url") ?? "").trim();
  if (url.length === 0) {
    redirectWithNotice("URL is required.");
  }

  const result = await Effect.runPromise(adminRpc((rpc) => rpc.resolveUrl(url)));

  revalidatePath("/");
  if (result.status === "matched") {
    redirectWithNotice(`Matched story ${result.storyId}.`);
  }

  redirectWithNotice(`Queued crawl for ${url}.`);
}

export async function reingestFailedVerificationAction(formData: FormData) {
  const statuses = crawlStatusesFrom(formData);
  const sourceDomain = String(formData.get("sourceDomain") ?? "").trim();
  const limitValue = String(formData.get("limit") ?? "100").trim();
  const limit = Number(limitValue);

  if (!Number.isFinite(limit) || limit < 1) {
    redirectWithNotice("Limit must be a positive number.");
  }

  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const env = yield* loadServerEnv(process.env);
      if (!env.DATABASE_URL) {
        return yield* Effect.fail(new Error("DATABASE_URL is required."));
      }
      const appLayer = makeAppLayer(env);
      const structuredAiLayer = StructuredAiLive(resolveModelPolicy(env)).pipe(
        Layer.provide(appLayer),
      );
      return yield* reingestFailedVerificationArticles(env.DATABASE_URL, {
        statuses,
        sourceDomain: sourceDomain.length > 0 ? sourceDomain : null,
        limit,
        aiModelPolicy: resolveModelPolicy(env),
        overrideTitleMismatches:
          String(formData.get("overrideTitleMismatches") ?? "") === "on",
      }).pipe(Effect.provide(Layer.mergeAll(appLayer, structuredAiLayer)));
    }),
  );

  revalidatePath("/");
  redirectWithNotice(
    `Reingested ${result.processedCount} articles, reverified ${result.reverifiedCount}, queued ${result.articleAiJobCount + result.sourceAiJobCount} AI jobs, rebuilt ${result.storyCount} stories.`,
  );
}
