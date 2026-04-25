import {
  NewsRpcClient,
  NewsRpcClientLive,
  type NewsRpcClientShape,
} from "@news/platform";
import { Effect } from "effect";
import { env } from "../env";

export const adminRpc = <A>(
  f: (rpc: NewsRpcClientShape) => Effect.Effect<A, never | unknown>,
) =>
  Effect.gen(function* () {
    const rpc = yield* NewsRpcClient;
    return yield* f(rpc);
  }).pipe(
    Effect.provide(
      NewsRpcClientLive({
        apiBaseUrl: env.NEXT_PUBLIC_API_BASE_URL,
        serviceToken: env.INTERNAL_SERVICE_TOKEN,
      }),
    ),
  );
