import { Effect } from "effect";
import { Configuration } from "./configuration";
import { parseDocument } from "./dom";
import { ArticleBinaryDataException, ArticleException } from "./errors";
import {
  extractArticleBody,
  extractAuthors,
  extractImages,
  extractMeta,
  extractPublishDate,
  extractTitle,
  extractVideos,
} from "./extractors";
import { StopWords, keywords, summarize } from "./nlp";
import { CrawlerHttp } from "./transport";
import type { ArticleJson } from "./types";
import { prepareUrl, validUrl } from "./url";

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
    this.sourceUrl =
      sourceUrl ||
      `${new URL(prepareUrl(url)).protocol}//${new URL(prepareUrl(url)).hostname}`;
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
    return Effect.gen(
      function* (this: Article) {
        if (options?.inputHtml != null) {
          this.html = options.inputHtml;
          if (options.title) this.title = options.title;
          return this;
        }

        const http = yield* CrawlerHttp;
        const response = yield* http.request(
          this.url,
          this.config.requestsParams,
        );
        const contentType = response.headers.get("content-type") ?? "";
        if (
          !this.config.allowBinaryContent &&
          /^(image|video|audio|font|application\/(?!json|xml))/i.test(
            contentType,
          )
        ) {
          this.downloadState = ArticleDownloadState.FAILED_RESPONSE;
          this.downloadExceptionMsg = `Article is binary data: ${this.url}`;
          return yield* new ArticleBinaryDataException({
            message: this.downloadExceptionMsg,
          });
        }
        const html = yield* response.text;
        this.html = html;
        if (options?.title) this.title = options.title;
        return this;
      }.bind(this),
    );
  }

  parse() {
    return Effect.gen(
      function* (this: Article) {
        if (this.downloadState === ArticleDownloadState.NOT_STARTED) {
          return yield* new ArticleException({
            message: "You must `download()` an article first!",
          });
        }

        this.doc = parseDocument(this.html);
        const document = this.doc;
        if (!document) {
          this.isParsed = true;
          return this;
        }

        this.title = extractTitle(document, this.config);
        this.authors = extractAuthors(document).slice(
          0,
          this.config.maxAuthors,
        );

        const meta = extractMeta(document, this.url);
        this.metaLang = meta.language ?? "";
        if (meta.language && this.config.useMetaLanguage) {
          this.config.language = meta.language;
        }
        this.metaDescription = meta.description;
        this.metaSiteName = meta.siteName;
        this.canonicalLink = meta.canonicalLink;
        this.metaKeywords = meta.keywords.slice(0, this.config.maxKeywords);
        this.tags = new Set(meta.tags);
        this.metaData = meta.data;
        this.publishDate = extractPublishDate(document, this.url);

        const body = extractArticleBody(
          document,
          this.config.language ?? "en",
          this.title,
        );
        this.topNode = body.topNode;
        this.articleHtml = this.config.cleanArticleHtml
          ? body.articleHtml
          : this.html;
        this.text = body.text;

        const videos = extractVideos(document, this.topNode);
        this.movies = videos
          .map((video) => video.src)
          .filter((value): value is string => Boolean(value));

        const currentTopNode = this.topNode;
        const currentUrl = this.url;
        const currentConfig = this.config;
        const images = this.config.fetchImages
          ? yield* Effect.gen(function* () {
              const http = yield* CrawlerHttp;
              return yield* Effect.promise(() =>
                extractImages(
                  document,
                  currentTopNode,
                  currentUrl,
                  currentConfig,
                  async (url, referer) => {
                    const result = await Effect.runPromiseExit(
                      http.request(url, {
                        ...currentConfig.requestsParams,
                        headers: {
                          ...currentConfig.requestsParams.headers,
                          Referer: referer,
                        },
                      }),
                    );
                    if (result._tag === "Failure") return null;
                    const bytes = await Effect.runPromiseExit(
                      result.value.bytes,
                    );
                    return bytes._tag === "Failure" ? null : bytes.value;
                  },
                ),
              );
            })
          : yield* Effect.promise(() =>
              extractImages(
                document,
                currentTopNode,
                currentUrl,
                currentConfig,
                async () => null,
              ),
            );
        this.metaFavicon = images.favicon;
        this.metaImg = images.metaImage;
        this.images = images.images;
        this.topImage = images.topImage;

        this.isParsed = true;
        return this;
      }.bind(this),
    );
  }

  nlp() {
    return Effect.gen(
      function* (this: Article) {
        if (this.downloadState === ArticleDownloadState.NOT_STARTED) {
          return yield* new ArticleException({
            message: "You must `download()` an article first!",
          });
        }
        if (!this.isParsed) {
          return yield* new ArticleException({
            message: "You must `parse()` an article first!",
          });
        }

        const stopwords = new StopWords(this.config.language ?? "en");
        const textKeywords = keywords(
          this.text,
          stopwords,
          this.config.maxKeywords,
        );
        const titleKeywords = keywords(
          this.title,
          stopwords,
          this.config.maxKeywords,
        );
        const merged = new Map<string, number>();
        for (const [token, score] of Object.entries(textKeywords)) {
          merged.set(token, score);
        }
        for (const [token, score] of Object.entries(titleKeywords)) {
          merged.set(
            token,
            merged.has(token) ? ((merged.get(token) ?? 0) + score) / 2 : score,
          );
        }
        this.keywordScores = Object.fromEntries(
          Array.from(merged.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, this.config.maxKeywords),
        );
        this.keywords = Object.keys(this.keywordScores);
        this.summary = summarize(
          this.title,
          this.text,
          stopwords,
          this.config.maxSummarySent,
        ).join("\n");
        return this;
      }.bind(this),
    );
  }

  isValidUrl() {
    return validUrl(this.url);
  }

  isMediaNews() {
    return [
      "/video",
      "/slide",
      "/gallery",
      "/powerpoint",
      "/fashion",
      "/glamour",
      "/cloth",
    ].some((entry) => this.url.includes(entry));
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
