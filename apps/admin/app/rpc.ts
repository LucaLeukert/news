import {
  NewsRpcClient,
  NewsRpcClientLive,
  type NewsRpcClientShape,
} from "@news/platform";
import { Effect } from "effect";
import { headers } from "next/headers";
import { env } from "../env";

const forwardedProtocol = (value: string | null) => {
  switch (value) {
    case "http":
    case "https":
      return value;
    default:
      return null;
  }
};

const requestOrigin = async () => {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const protocol = forwardedProtocol(requestHeaders.get("x-forwarded-proto"));

  if (host && protocol) {
    return `${protocol}://${host}`;
  }

  return env.NEXT_PUBLIC_API_BASE_URL;
};

const withRpcClient = <A>(
  f: (rpc: NewsRpcClientShape) => Effect.Effect<A, never | unknown>,
) =>
  Effect.tryPromise(async () => {
    const layer = NewsRpcClientLive({
      apiBaseUrl: await requestOrigin(),
      serviceToken: env.INTERNAL_SERVICE_TOKEN,
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        const rpc = yield* NewsRpcClient;
        return yield* f(rpc);
      }).pipe(Effect.provide(layer)),
    );
  });

export const adminRpc = <A>(
  f: (rpc: NewsRpcClientShape) => Effect.Effect<A, never | unknown>,
) => withRpcClient(f);
