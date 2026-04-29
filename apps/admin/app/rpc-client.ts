"use client";

import {
  NewsRpcClient,
  NewsRpcClientLive,
  type NewsRpcClientShape,
} from "@news/platform";
import type {
  AdminAiJobDetail,
  AdminAiJobListItem,
  AdminAiJobQuery,
  OperationsSnapshot,
} from "@news/types";
import {
  type UseQueryOptions,
  type UseQueryResult,
  useQuery,
} from "@tanstack/react-query";
import { Effect } from "effect";

const browserRpcLayer = NewsRpcClientLive({
  apiBaseUrl: "",
});

const runBrowserAdminRpc = <A>(
  f: (rpc: NewsRpcClientShape) => Effect.Effect<A, never | unknown>,
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const rpc = yield* NewsRpcClient;
      return yield* f(rpc);
    }).pipe(Effect.provide(browserRpcLayer)),
  );

export const adminQueryKeys = {
  operations: () => ["admin", "operations"] as const,
  aiJobs: (query: AdminAiJobQuery) =>
    ["admin", "ai-jobs", query.limit ?? 100] as const,
  aiJobDetail: (jobId: string) => ["admin", "ai-jobs", jobId] as const,
};

type AdminQueryOptions<TData> = Omit<
  UseQueryOptions<TData, Error, TData, readonly unknown[]>,
  "queryKey" | "queryFn"
>;

const useAdminRpcQuery = <TData>(
  queryKey: readonly unknown[],
  queryFn: () => Promise<TData>,
  options?: AdminQueryOptions<TData>,
): UseQueryResult<TData, Error> =>
  useQuery({
    queryKey,
    queryFn,
    ...options,
  });

export const useOperationsSnapshotQuery = (initialData: OperationsSnapshot) =>
  useAdminRpcQuery(
    adminQueryKeys.operations(),
    () => runBrowserAdminRpc((rpc) => rpc.getOperationsSnapshot()),
    {
      initialData,
      refetchInterval: 5_000,
    },
  );

export const useAdminAiJobsQuery = (
  query: AdminAiJobQuery,
  initialData: ReadonlyArray<AdminAiJobListItem>,
) =>
  useAdminRpcQuery(
    adminQueryKeys.aiJobs(query),
    () => runBrowserAdminRpc((rpc) => rpc.listAdminAiJobs(query)),
    {
      initialData,
      refetchInterval: 5_000,
    },
  );

export const useAdminAiJobDetailQuery = (
  jobId: string,
  initialData: AdminAiJobDetail,
) =>
  useAdminRpcQuery(
    adminQueryKeys.aiJobDetail(jobId),
    () =>
      runBrowserAdminRpc((rpc) => rpc.getAdminAiJobDetail(jobId)).then(
        (detail) => {
          if (!detail) {
            throw new Error(`AI job ${jobId} not found`);
          }
          return detail;
        },
      ),
    {
      initialData,
      refetchInterval: 5_000,
    },
  );
