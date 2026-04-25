import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ArticleException } from "./errors";

const currentDir = dirname(fileURLToPath(import.meta.url));
const stopwordsDir = join(currentDir, "..", "resources", "text");

export const getAvailableLanguages = (): ReadonlyArray<string> =>
  readFileSync(join(stopwordsDir, "index.txt"), "utf8")
    .split("\n")
    .map((value) => value.trim())
    .filter(Boolean);

export class Configuration {
  minWordCount = 300;
  minSentCount = 7;
  maxTitle = 200;
  maxText = 100_000;
  maxKeywords = 35;
  maxAuthors = 10;
  maxSummary = 5000;
  maxSummarySent = 5;
  maxFileMemo = 20_000;
  topImageSettings = {
    minWidth: 300,
    minHeight: 200,
    minArea: 10_000,
    maxRetries: 2,
  } as const;
  memorizeArticles = true;
  disableCategoryCache = false;
  fetchImages = true;
  followMetaRefresh = false;
  cleanArticleHtml = true;
  httpSuccessOnly = true;
  numberThreads = 10;
  threadTimeoutSeconds = 10;
  allowBinaryContent = false;
  ignoredContentTypesDefaults: Record<string, string> = {};
  requestsParams: RequestInit & {
    headers: Record<string, string>;
    timeout?: number;
  } = {
    headers: {
      "User-Agent": "newspaper-ts/0.0.0",
      "Accept-Encoding": "gzip, deflate, br",
    },
    timeout: 7000,
  };
  private _language = "en";
  private _useMetaLanguage = true;

  constructor(init?: Partial<Configuration>) {
    if (init) {
      this.update(init);
    }
  }

  update(input: Partial<Configuration>) {
    Object.assign(this, input);
  }

  get browserUserAgent() {
    return this.requestsParams.headers["User-Agent"];
  }

  set browserUserAgent(value: string | undefined) {
    if (value) {
      this.requestsParams.headers["User-Agent"] = value;
    }
  }

  get language() {
    return this._language;
  }

  set language(value: string | null) {
    if (value == null) {
      this._useMetaLanguage = true;
      this._language = "en";
      return;
    }

    const normalized = value.toLowerCase().slice(0, 2);
    if (normalized.length !== 2) {
      throw new ArticleException({
        message: "Language must be a 2-character ISO code",
      });
    }

    if (!getAvailableLanguages().includes(normalized)) {
      throw new ArticleException({
        message: `Unsupported language: ${normalized}`,
      });
    }

    this._useMetaLanguage = false;
    this._language = normalized;
  }

  get useMetaLanguage() {
    return this._useMetaLanguage;
  }
}
