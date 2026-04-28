import { extractMetadataEffect } from "@news/crawler-core";
import {
  Article as NewspaperArticle,
  Configuration as NewspaperConfiguration,
  CrawlerHttpLive,
} from "@news/newspaper";
import { Effect } from "effect";

const newspaperConfig = new NewspaperConfiguration({
  fetchImages: false,
});

export const parseArticleWithNewspaper = (url: string, html: string) =>
  Effect.gen(function* () {
    const article = new NewspaperArticle(
      url,
      "",
      "",
      "",
      new NewspaperConfiguration({
        ...newspaperConfig,
        fetchImages: false,
      }),
    );
    article.html = html;
    yield* article.parse().pipe(Effect.provide(CrawlerHttpLive));

    return {
      canonicalUrl: article.canonicalLink || article.url,
      title: article.title || null,
      description: article.metaDescription || null,
      author: article.authors[0] ?? null,
      publishedAt: article.publishDate?.toISOString() ?? null,
      language: article.metaLang || article.config.language || null,
      paywalled: false,
    };
  }).pipe(
    Effect.catchIf(
      () => true,
      () => extractMetadataEffect(html, url),
    ),
  );
