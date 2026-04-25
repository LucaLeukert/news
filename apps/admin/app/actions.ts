"use server";

import { Effect } from "effect";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
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
