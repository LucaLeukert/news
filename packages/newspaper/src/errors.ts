import { Data } from "effect";

export class NewspaperError extends Data.TaggedError("NewspaperError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class ArticleException extends Data.TaggedError("ArticleException")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class ArticleBinaryDataException extends Data.TaggedError(
  "ArticleBinaryDataException",
)<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class RobotsException extends Data.TaggedError("RobotsException")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}
