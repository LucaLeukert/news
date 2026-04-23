import { Context, Effect, Layer, Schedule } from "effect";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import type * as HttpHeaders from "effect/unstable/http/Headers";
import * as HttpClient from "effect/unstable/http/HttpClient";
import type * as HttpClientError from "effect/unstable/http/HttpClientError";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import type { HttpMethod } from "effect/unstable/http/HttpMethod";
import { HttpError } from "./errors";
import { MetricsLive, MetricsService } from "./metrics";

export interface HttpResponse {
  readonly status: number;
  readonly url: string;
  readonly text: Effect.Effect<string, HttpError>;
  readonly json: <A>() => Effect.Effect<A, HttpError>;
}

export interface HttpServiceShape {
  readonly request: (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => Effect.Effect<HttpResponse, HttpError>;
  readonly json: <A>(
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => Effect.Effect<A, HttpError>;
}

export class HttpService extends Context.Service<
  HttpService,
  HttpServiceShape
>()("@news/platform/HttpService") {}

const toHeadersInput = (
  headers: HeadersInit | undefined,
): HttpHeaders.Input | undefined => {
  if (!headers) return undefined;
  if (Array.isArray(headers)) return headers;
  if (headers instanceof globalThis.Headers) return headers.entries();
  return headers;
};

const toRequest = (input: RequestInfo | URL, init?: RequestInit) => {
  const requestInput: Request | undefined =
    typeof input === "string" || input instanceof URL ? undefined : input;
  const url: string | URL = requestInput
    ? requestInput.url
    : (input as string | URL);
  const method = (init?.method ?? requestInput?.method ?? "GET").toUpperCase();
  const headers = toHeadersInput(init?.headers ?? requestInput?.headers);
  const body = init?.body ?? requestInput?.body;
  let request = HttpClientRequest.make(method as HttpMethod)(url, { headers });

  if (typeof body === "string") {
    request = HttpClientRequest.bodyText(request, body);
  } else if (body instanceof Uint8Array) {
    request = HttpClientRequest.bodyUint8Array(request, body);
  }

  return request;
};

const mapHttpClientError = (cause: HttpClientError.HttpClientError) =>
  new HttpError({ message: "Fetch failed", cause });

export const HttpLayer = Layer.effect(
  HttpService,
  Effect.gen(function* () {
    const metrics = yield* MetricsService;
    const client = yield* HttpClient.HttpClient;

    const request = (input: RequestInfo | URL, init?: RequestInit) =>
      client.execute(toRequest(input, init)).pipe(
        Effect.mapError(mapHttpClientError),
        Effect.flatMap((response) =>
          response.status >= 200 && response.status < 300
            ? Effect.succeed(response)
            : Effect.fail(
                new HttpError({
                  message: `HTTP ${response.status}`,
                  status: response.status,
                }),
              ),
        ),
        Effect.retry(
          Schedule.exponential("100 millis").pipe(
            Schedule.both(Schedule.recurs(2)),
          ),
        ),
        Effect.map(
          (response): HttpResponse => ({
            status: response.status,
            url:
              typeof input === "string" || input instanceof URL
                ? String(input)
                : input.url,
            text: response.text.pipe(Effect.mapError(mapHttpClientError)),
            json: <A>() =>
              response.json.pipe(
                Effect.map((value) => value as A),
                Effect.mapError(mapHttpClientError),
              ),
          }),
        ),
        Effect.tapError((error) =>
          Effect.gen(function* () {
            yield* metrics.increment("crawl.extraction_failure", {
              status: String(error.status ?? "network"),
            });
            yield* Effect.logWarning("http.request.failed", error);
          }),
        ),
      );

    return {
      request,
      json: <A>(input: RequestInfo | URL, init?: RequestInit) =>
        request(input, init).pipe(
          Effect.flatMap((response) => response.json<A>()),
        ),
    } satisfies HttpServiceShape;
  }),
);

export const HttpLive = HttpLayer.pipe(
  Layer.provide(Layer.merge(MetricsLive, FetchHttpClient.layer)),
);
