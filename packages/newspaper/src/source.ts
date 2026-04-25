import { Effect } from "effect";
import { parse as parseDomain } from "tldts";
import { Configuration } from "./configuration";
import { extractArticleLinks, extractCategoryUrls, extractFeedUrls } from "./extractors";
import { parseDocument } from "./dom";
import { prepareUrl, validUrl } from "./url";
import type { Category, Feed } from "./types";
import { Article } from "./article";
import { CrawlerHttp, type CrawlerResponse } from "./transport";

const uniqueBy = <T, K>(items: ReadonlyArray<T>, key: (item: T) => K) =>
  Array.from(new Map(items.map((item) => [key(item), item])).values());

export class Source {
  readonly config: Configuration;
  readonly url: string;
  readonly domain: string;
  readonly scheme: string;
  readonly brand: string;
  readonly readMoreLink: string;

  categories: Category[] = [];
  feeds: Feed[] = [];
  articles: Article[] = [];
  html = "";
  doc: Document | null = null;
  description = "";
  logoUrl = "";
  favicon = "";
  isParsed = false;
  isDownloaded = false;

  constructor(
    url: string,
    readMoreLink = "",
    config = new Configuration(),
    overrides?: Partial<Configuration>,
  ) {
    if (!/^https?:\/\//.test(url)) {
      throw new Error("Input url is bad!");
    }
    this.config = config;
    this.config.update(overrides ?? {});
    this.url = prepareUrl(url);
    this.domain = new URL(this.url).hostname;
    this.scheme = new URL(this.url).protocol.replace(":", "");
    this.brand = parseDomain(this.url).domain ?? this.domain;
    this.readMoreLink = readMoreLink;
  }

  build(options?: {
    readonly inputHtml?: string;
    readonly onlyHomepage?: boolean;
    readonly onlyInPath?: boolean;
  }) {
    const self = this;
    return Effect.gen(function* () {
      if (options?.inputHtml) {
        self.html = options.inputHtml;
        self.isDownloaded = true;
      } else {
        yield* self.download();
      }

      self.parse();
      if (!self.doc) return self;

      if (options?.onlyHomepage) {
        self.categories = [{ url: self.url, html: self.html, doc: self.doc }];
      } else {
        self.setCategories();
        yield* self.downloadCategories();
        self.parseCategories();
      }

      if (!options?.onlyHomepage) {
        self.setFeeds();
        yield* self.downloadFeeds();
      }

      self.generateArticles({ onlyInPath: options?.onlyInPath });
      return self;
    });
  }

  download() {
    const self = this;
    return Effect.gen(function* () {
      const http = yield* CrawlerHttp;
      const response = yield* http.request(self.url, self.config.requestsParams);
      self.html = yield* response.text;
      self.isDownloaded = true;
      return self;
    });
  }

  parse() {
    this.doc = parseDocument(this.html);
    if (!this.doc) return;
    this.description =
      this.doc
        .querySelector('meta[name="description"]')
        ?.getAttribute("content")
        ?.trim() ?? "";
  }

  setCategories() {
    if (!this.doc) return;
    this.categories = extractCategoryUrls(this.url, this.doc).map((url) => ({
      url,
      html: null,
      doc: null,
    }));
  }

  downloadCategories() {
    const self = this;
    return Effect.gen(function* () {
      const http = yield* CrawlerHttp;
      for (const category of self.categories) {
        const response = yield* http
          .request(category.url, self.config.requestsParams)
          .pipe(Effect.orElseSucceed(() => null as CrawlerResponse | null));
        if (response) {
          category.html = yield* response.text;
        }
      }
      self.categories = self.categories.filter((category: Category) => Boolean(category.html));
      return self.categories;
    });
  }

  parseCategories() {
    this.categories = this.categories
      .map((category) => ({
        ...category,
        doc: category.html ? parseDocument(category.html) : null,
      }))
      .filter((category): category is Category => category.doc !== null);
  }

  setFeeds() {
    if (!this.doc) return;
    const documents = [
      this.doc,
      ...this.categories.map((category) => category.doc).filter(Boolean),
    ];
    this.feeds = extractFeedUrls(this.url, documents as Document[]).map((url) => ({
      url,
      rss: null,
    }));
  }

  downloadFeeds() {
    const self = this;
    return Effect.gen(function* () {
      const http = yield* CrawlerHttp;
      for (const feed of self.feeds) {
        const response = yield* http
          .request(feed.url, self.config.requestsParams)
          .pipe(Effect.orElseSucceed(() => null as CrawlerResponse | null));
        if (response) {
          feed.rss = yield* response.text;
        }
      }
      self.feeds = self.feeds.filter((feed: Feed) => Boolean(feed.rss));
      return self.feeds;
    });
  }

  private feedArticles() {
    return this.feeds.flatMap((feed) => {
      const rssDoc = feed.rss ? parseDocument(feed.rss) : null;
      if (!rssDoc) return [];
      return Array.from(rssDoc.querySelectorAll("item > link, entry > link"))
        .map((node) => node.textContent?.trim() ?? node.getAttribute("href") ?? "")
        .filter(validUrl)
        .map(
          (url) =>
            new Article(url, "", feed.url, this.readMoreLink, this.config),
        );
    });
  }

  private categoryArticles() {
    return this.categories.flatMap((category) => {
      if (!category.doc) return [];
      return extractArticleLinks(category.doc, category.url).map(
        (entry) =>
          new Article(
            entry.url,
            entry.title,
            category.url,
            this.readMoreLink,
            this.config,
          ),
      );
    });
  }

  generateArticles(options?: { readonly limit?: number; readonly onlyInPath?: boolean }) {
    const limit = options?.limit ?? 5000;
    let articles = uniqueBy(
      [...this.feedArticles(), ...this.categoryArticles()],
      (article) => article.url,
    );

    if (options?.onlyInPath) {
      const currentPath = new URL(this.url).pathname;
      articles = articles.filter((article) => {
        const parsed = new URL(article.url);
        return (
          parsed.hostname === this.domain &&
          parsed.pathname.startsWith(currentPath)
        );
      });
    }

    this.articles = articles.slice(0, limit);
  }

  downloadArticles() {
    const self = this;
    return Effect.gen(function* () {
      for (const article of self.articles) {
        yield* article.download();
      }
      self.isDownloaded = true;
      return self.articles;
    });
  }

  parseArticles() {
    const self = this;
    return Effect.gen(function* () {
      for (const article of self.articles) {
        yield* article.parse();
      }
      self.articles = self.articles.filter((article: Article) => article.isValidBody());
      self.isParsed = true;
      return self.articles;
    });
  }

  size() {
    return this.articles.length;
  }

  feedUrls() {
    return this.feeds.map((feed) => feed.url);
  }

  categoryUrls() {
    return this.categories.map((category) => category.url);
  }

  articleUrls() {
    return this.articles.map((article) => article.url);
  }
}
