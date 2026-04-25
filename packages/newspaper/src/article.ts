import { Effect } from "effect";
import { ArticleBinaryDataException, ArticleException } from "./errors";
import { Configuration } from "./configuration";
import {
  extractArticleBody,
  extractAuthors,
  extractImages,
  extractMeta,
  extractPublishDate,
  extractTitle,
  extractVideos,
} from "./extractors";
import { parseDocument } from "./dom";
import { keywords, StopWords, summarize } from "./nlp";
import type { ArticleJson } from "./types";
import { prepareUrl, validUrl } from "./url";
import { CrawlerHttp } from "./transport";

export enum ArticleDownloadState {
  NOT_STARTED = 0,
  FAILED_RESPONSE = 1,
  SUCCESS = 2,
}

export class Article {
  readonly config: Configuration;
  readonly extractor = null;
  readonly sourceUrl: string;
  readonly originalUrl: string;
  readMoreLink: string;
  url: string;
  topImage = "";
  metaImg = "";
  images: string[] = [];
  movies: string[] = [];
  keywords: string[] = [];
  keywordScores: Record<string, number> = {};
  metaKeywords: string[] = [];
  tags = new Set<string>();
  authors: string[] = [];
  publishDate: Date | null = null;
  articleHtml = "";
  isParsed = false;
  downloadState = ArticleDownloadState.NOT_STARTED;
  downloadExceptionMsg: string | null = null;
  history: string[] = [];
  metaDescription = "";
  metaLang = "";
  metaFavicon = "";
  metaSiteName = "";
  metaData: Record<string, unknown> = {};
  canonicalLink = "";
  topNode: Element | null = null;
  doc: Document | null = null;
  private _title = "";
  private _text = "";
  private _html = "";
  private _summary = "";

  constructor(
    url: string,
    title = "",
    sourceUrl = "",
    readMoreLink = "",
    config = new Configuration(),
    overrides?: Partial<Configuration>,
  ) {
    this.config = config;
    this.config.update(overrides ?? {});
    this.sourceUrl = sourceUrl || `${new URL(prepareUrl(url)).protocol}//${new URL(prepareUrl(url)).hostname}`;
    this.url = prepareUrl(url, this.sourceUrl);
    this.originalUrl = this.url;
    this.title = title;
    this.readMoreLink = readMoreLink;
  }

  build() {
    return this.download().pipe(
      Effect.flatMap(() => this.parse()),
      Effect.flatMap(() => this.nlp()),
      Effect.map(() => this),
    );
  }

  download(options?: {
    readonly inputHtml?: string;
    readonly title?: string;
    readonly ignoreReadMore?: boolean;
  }) {
    const self = this;
    return Effect.gen(function* () {
      if (options?.inputHtml != null) {
        self.html = options.inputHtml;
        if (options.title) self.title = options.title;
        return self;
      }

      const http = yield* CrawlerHttp;
      const response = yield* http.request(self.url, self.config.requestsParams);
      const contentType = response.headers.get("content-type") ?? "";
      if (
        !self.config.allowBinaryContent &&
        /^(image|video|audio|font|application\/(?!json|xml))/i.test(contentType)
      ) {
        self.downloadState = ArticleDownloadState.FAILED_RESPONSE;
        self.downloadExceptionMsg = `Article is binary data: ${self.url}`;
        return yield* new ArticleBinaryDataException({
          message: self.downloadExceptionMsg,
        });
      }
      const html = yield* response.text;
      self.html = html;
      if (options?.title) self.title = options.title;
      return self;
    });
  }

  parse() {
    const self = this;
    return Effect.gen(function* () {
      if (self.downloadState === ArticleDownloadState.NOT_STARTED) {
        return yield* new ArticleException({
          message: "You must `download()` an article first!",
        });
      }

      self.doc = parseDocument(self.html);
      if (!self.doc) {
        self.isParsed = true;
        return self;
      }

      self.title = extractTitle(self.doc, self.config);
      self.authors = extractAuthors(self.doc).slice(0, self.config.maxAuthors);

      const meta = extractMeta(self.doc, self.url);
      self.metaLang = meta.language ?? "";
      if (meta.language && self.config.useMetaLanguage) {
        self.config.language = meta.language;
      }
      self.metaDescription = meta.description;
      self.metaSiteName = meta.siteName;
      self.canonicalLink = meta.canonicalLink;
      self.metaKeywords = meta.keywords.slice(0, self.config.maxKeywords);
      self.tags = new Set(meta.tags);
      self.metaData = meta.data;
      self.publishDate = extractPublishDate(self.doc, self.url);

      const body = extractArticleBody(
        self.doc,
        self.config.language ?? "en",
        self.title,
      );
      self.topNode = body.topNode;
      self.articleHtml = self.config.cleanArticleHtml ? body.articleHtml : self.html;
      self.text = body.text;

      const videos = extractVideos(self.doc, self.topNode);
      self.movies = videos.map((video) => video.src).filter((value): value is string => Boolean(value));

      const images = self.config.fetchImages
        ? yield* Effect.gen(function* () {
            const http = yield* CrawlerHttp;
            return yield* Effect.promise(() =>
              extractImages(
                self.doc!,
                self.topNode,
                self.url,
                self.config,
                async (url, referer) => {
                  const result = await Effect.runPromiseExit(
                    http.request(url, {
                      ...self.config.requestsParams,
                      headers: {
                        ...self.config.requestsParams.headers,
                        Referer: referer,
                      },
                    }),
                  );
                  if (result._tag === "Failure") return null;
                  const bytes = await Effect.runPromiseExit(result.value.bytes);
                  return bytes._tag === "Failure" ? null : bytes.value;
                },
              ),
            );
          })
        : yield* Effect.promise(() =>
            extractImages(
              self.doc!,
              self.topNode,
              self.url,
              self.config,
              async () => null,
            ),
          );
      self.metaFavicon = images.favicon;
      self.metaImg = images.metaImage;
      self.images = images.images;
      self.topImage = images.topImage;

      self.isParsed = true;
      return self;
    });
  }

  nlp() {
    const self = this;
    return Effect.gen(function* () {
      if (self.downloadState === ArticleDownloadState.NOT_STARTED) {
        return yield* new ArticleException({
          message: "You must `download()` an article first!",
        });
      }
      if (!self.isParsed) {
        return yield* new ArticleException({
          message: "You must `parse()` an article first!",
        });
      }

      const stopwords = new StopWords(self.config.language ?? "en");
      const textKeywords = keywords(self.text, stopwords, self.config.maxKeywords);
      const titleKeywords = keywords(self.title, stopwords, self.config.maxKeywords);
      const merged = new Map<string, number>();
      for (const [token, score] of Object.entries(textKeywords)) {
        merged.set(token, score);
      }
      for (const [token, score] of Object.entries(titleKeywords)) {
        merged.set(token, merged.has(token) ? ((merged.get(token) ?? 0) + score) / 2 : score);
      }
      self.keywordScores = Object.fromEntries(
        Array.from(merged.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, self.config.maxKeywords),
      );
      self.keywords = Object.keys(self.keywordScores);
      self.summary = summarize(
        self.title,
        self.text,
        stopwords,
        self.config.maxSummarySent,
      ).join("\n");
      return self;
    });
  }

  isValidUrl() {
    return validUrl(this.url);
  }

  isMediaNews() {
    return ["/video", "/slide", "/gallery", "/powerpoint", "/fashion", "/glamour", "/cloth"].some((entry) =>
      this.url.includes(entry),
    );
  }

  isValidBody() {
    if (!this.isParsed) {
      throw new ArticleException({
        message: "must parse article before checking if body is valid!",
      });
    }
    const wordCount = this.text.split(/\s+/).filter(Boolean).length;
    const sentCount = this.text.split(".").filter(Boolean).length;
    if (!this.isMediaNews() && !this.text) return false;
    if (!this.title || this.title.split(/\s+/).length < 2) return false;
    if (wordCount < this.config.minWordCount) return false;
    if (sentCount < this.config.minSentCount) return false;
    if (!this.html) return false;
    return true;
  }

  toJson(asString = true) {
    const payload: ArticleJson = {
      url: this.url,
      read_more_link: this.readMoreLink,
      language: this.config.language ?? "en",
      title: this.title,
      top_image: this.topImage,
      meta_img: this.metaImg,
      images: this.images,
      movies: this.movies,
      keywords: this.keywords,
      meta_keywords: this.metaKeywords,
      tags: Array.from(this.tags),
      authors: this.authors,
      publish_date: this.publishDate?.toISOString() ?? null,
      summary: this.summary,
      meta_description: this.metaDescription,
      meta_lang: this.metaLang,
      meta_favicon: this.metaFavicon,
      meta_site_name: this.metaSiteName,
      canonical_link: this.canonicalLink,
      text: this.text,
      text_cleaned: this.text,
    };
    return asString ? JSON.stringify(payload, null, 2) : payload;
  }

  get title() {
    return this._title;
  }

  set title(value: string) {
    this._title = value ? value.slice(0, this.config.maxTitle) : "";
  }

  get text() {
    return this._text;
  }

  set text(value: string) {
    this._text = value ? value.slice(0, this.config.maxText) : "";
  }

  get html() {
    return this._html;
  }

  set html(value: string) {
    this.downloadState = ArticleDownloadState.SUCCESS;
    this._html = value ?? "";
  }

  get summary() {
    return this._summary;
  }

  set summary(value: string) {
    this._summary = value ? value.slice(0, this.config.maxSummary) : "";
  }
}
