#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

DATABASE_URL="$(awk -F= '/^DATABASE_URL=/{print substr($0,index($0,$2))}' .env)"
NEXT_PUBLIC_CONVEX_URL="$(awk -F= '/^NEXT_PUBLIC_CONVEX_URL=/{print substr($0,index($0,$2))}' .env)"
INTERNAL_SERVICE_TOKEN="$(awk -F= '/^INTERNAL_SERVICE_TOKEN=/{print substr($0,index($0,$2))}' .env)"

DATABASE_URL="${DATABASE_URL}" bun -e '
  import {
    createDb,
    aiResults,
    aiJobs,
    claims,
    entities,
    sourceRatings,
    storyEntities,
    storyArticles,
    storyMetrics,
    stories,
    articleVersions,
    articles,
    sourceFeeds,
    sources,
  } from "./packages/db/src/index.ts";

  const db = createDb(process.env.DATABASE_URL);
  await db.delete(aiResults);
  await db.delete(aiJobs);
  await db.delete(claims);
  await db.delete(storyEntities);
  await db.delete(entities);
  await db.delete(storyArticles);
  await db.delete(storyMetrics);
  await db.delete(stories);
  await db.delete(articleVersions);
  await db.delete(articles);
  await db.delete(sourceFeeds);
  await db.delete(sourceRatings);
  await db.delete(sources);
  console.log("Reset Neon canonical state.");
'

if [[ -n "${NEXT_PUBLIC_CONVEX_URL}" && -n "${INTERNAL_SERVICE_TOKEN}" ]]; then
  NEXT_PUBLIC_CONVEX_URL="${NEXT_PUBLIC_CONVEX_URL}" \
  INTERNAL_SERVICE_TOKEN="${INTERNAL_SERVICE_TOKEN}" \
    bun -e '
      import { ConvexHttpClient } from "convex/browser";
      import { api } from "./packages/convex/index.ts";

      const client = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL);
      await client.mutation(api.storyProjections.replacePublicProjectionsFromSync, {
        serviceToken: process.env.INTERNAL_SERVICE_TOKEN,
        stories: [],
        details: [],
      });
      console.log("Reset Convex public projections.");
    '
fi
