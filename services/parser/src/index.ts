import { extractMetadataEffect, makeSnippet } from "@news/crawler-core";
import { Effect } from "effect";

export const parseArticleHtml = (
  html: string,
  url: string,
  noSnippet = false,
) =>
  Effect.gen(function* () {
    const metadata = yield* extractMetadataEffect(html, url);
    return {
      ...metadata,
      snippet: makeSnippet(metadata.description, noSnippet),
      rawTextStoredPublicly: false,
    };
  });
