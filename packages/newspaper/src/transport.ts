import { Context, Effect, Layer, Schedule } from "effect";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import type * as HttpHeaders from "effect/unstable/http/Headers";
import type { HttpMethod } from "effect/unstable/http/HttpMethod";
import { NewspaperError } from "./errors";

export type CrawlerResponse = {
  readonly url: string;
  readonly status: number;
  readonly headers: Headers;
  readonly text: Effect.Effect<string, NewspaperError>;
  readonly bytes: Effect.Effect<Uint8Array, NewspaperError>;
};

export type CrawlerHttpShape = {
  readonly request: (
    input: string | URL,
    init?: RequestInit & { readonly timeout?: number },
  ) => Effect.Effect<CrawlerResponse, NewspaperError>;
};

export class CrawlerHttp extends Context.Service<CrawlerHttp, CrawlerHttpShape>()(
  "@news/newspaper/CrawlerHttp",
) {}

const toHeadersInput = (
  headers: HeadersInit | undefined,
): HttpHeaders.Input | undefined => {
  if (!headers) return undefined;
  if (Array.isArray(headers)) return headers;
  if (headers instanceof Headers) return headers.entries();
  return headers;
};

const toRequest = (input: string | URL, init?: RequestInit) => {
  let request = HttpClientRequest.make(
    ((init?.method ?? "GET").toUpperCase() as HttpMethod),
  )(input, {
    headers: toHeadersInput(init?.headers),
  });
  if (typeof init?.body === "string") {
    request = HttpClientRequest.bodyText(request, init.body);
  } else if (init?.body instanceof Uint8Array) {
    request = HttpClientRequest.bodyUint8Array(request, init.body);
  }
  return request;
};

const mapError = (cause: unknown) =>
  new NewspaperError({ message: "Crawler request failed", cause });

export const CrawlerHttpLive = Layer.effect(
  CrawlerHttp,
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    return {
      request: (input: string | URL, init?: RequestInit) =>
        client.execute(toRequest(input, init)).pipe(
          Effect.mapError(mapError),
          Effect.retry(
            Schedule.exponential("100 millis").pipe(
              Schedule.both(Schedule.recurs(2)),
            ),
          ),
          Effect.map((response) => ({
            url: String(input),
            status: response.status,
            headers: new Headers(
              Object.entries(response.headers as Record<string, string>),
            ),
            text: response.text.pipe(Effect.mapError(mapError)),
            bytes: response.arrayBuffer.pipe(
              Effect.map((buffer) => new Uint8Array(buffer)),
              Effect.mapError(mapError),
            ),
          })),
        ),
    } satisfies CrawlerHttpShape;
  }),
).pipe(Layer.provide(FetchHttpClient.layer));
