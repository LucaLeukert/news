import { Data } from "effect";

export class ConfigError extends Data.TaggedError("ConfigError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class HttpError extends Data.TaggedError("HttpError")<{
  readonly message: string;
  readonly status?: number;
  readonly cause?: unknown;
}> {}

export class AiGatewayError extends Data.TaggedError("AiGatewayError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class AuthError extends Data.TaggedError("AuthError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class BillingError extends Data.TaggedError("BillingError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}
