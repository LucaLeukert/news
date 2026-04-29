import * as chrono from "chrono-node";
import { imageSize } from "image-size";
import type { Configuration } from "./configuration";
import {
  absoluteUrl,
  attr,
  queryAll,
  removeNodes,
  serializeNode,
  textOf,
} from "./dom";
import { normalizeLanguageCode } from "./languages";
import { StopWords } from "./nlp";
import type { JsonValue, Video } from "./types";
import { prepareUrl, validUrl } from "./url";

const AUTHOR_ATTRS = ["name", "rel", "itemprop", "class", "id", "property"];
const AUTHOR_VALS = [
  "author",
  "byline",
  "dc.creator",
  "byl",
  "article:author",
  "article:author_name",
  "story-byline",
  "article-author",
  "parsely-author",
  "sailthru.author",
  "citation_author",
];

const AUTHOR_STOP_WORDS = [
  "By",
  "Reuters",
  "IANS",
  "AP",
  "AFP",
  "PTI",
  "ANI",
  "DPA",
  "Senior Reporter",
  "Reporter",
  "Writer",
  "Opinion Writer",
];

const META_IMAGE_SELECTORS = [
  'meta[property="og:image"]',
  'meta[name="og:image"]',
  'link[rel="image_src"]',
  'link[rel="img_src"]',
  'link[rel="icon"]',
];

const PUBLISH_DATE_META_INFO = [
  "published_date",
  "published_time",
  "pubdate",
  "publish_date",
  "dcterms.created",
  "article:published_time",
  "og:published_time",
  "datePublished",
  "uploadDate",
  "date",
  "publishedDate",
  "updated_time",
  "og:updated_time",
  "last-modified",
  "article:modified_time",
];

const BAD_NODE_PATTERNS =
  /(side|combx|retweet|comment|footer|social|sidebar|share|sponsor|breadcrumbs|subscribe|advert|related|caption|instagram|twitter|facebook)/i;

const ARTICLE_BODY_TAGS: ReadonlyArray<{
  readonly selector: string;
  readonly score: number;
}> = [
  { selector: 'article[role="article"]', score: 25 },
  { selector: '[itemprop="articleBody"]', score: 100 },
  { selector: '[itemprop="articleText"]', score: 40 },
  { selector: '[itemtype="https://schema.org/Article"]', score: 30 },
  { selector: '[itemtype="https://schema.org/NewsArticle"]', score: 30 },
  { selector: '[class*="entry-content"]', score: 15 },
  { selector: '[class*="article-body"]', score: 15 },
  { selector: '[class*="article-text"]', score: 15 },
];

const cleanText = (value: string) => value.replace(/\s+/g, " ").trim();

const normalized = (value: string) =>
  cleanText(value)
    .replace(/[^\p{Letter}\p{Number}\s]/gu, "")
    .toLowerCase();

const collectJsonLd = (document: Document) =>
  queryAll<HTMLScriptElement>(document, 'script[type="application/ld+json"]')
    .map((node) => node.textContent ?? "")
    .flatMap((value) => {
      try {
        const parsed = JSON.parse(value) as JsonValue;
        return Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        return [];
      }
    });

export const extractTitle = (document: Document, config: Configuration) => {
  const titleText = textOf(document.querySelector("title"));
  if (!titleText) return "";

  const h1Candidates = queryAll(document, "h1")
    .map((node) => cleanText(textOf(node)))
    .filter((value) => value.split(" ").length > 2)
    .sort((a, b) => b.length - a.length);
  const h1 = h1Candidates[0] ?? "";
  const ogTitle =
    [
      'meta[property="og:title"]',
      'meta[name="og:title"]',
      'meta[name="headline"]',
      'meta[name="title"]',
    ]
      .map(
        (selector) => attr(document.querySelector(selector), "content") ?? "",
      )
      .find(Boolean) ?? "";

  let candidate = titleText;
  if (h1 && normalized(h1) === normalized(titleText)) {
    candidate = h1;
  } else if (ogTitle && titleText.includes("|")) {
    candidate = ogTitle;
  } else if (h1 && normalized(h1) === normalized(ogTitle)) {
    candidate = h1;
  } else if (ogTitle && normalized(titleText).startsWith(normalized(ogTitle))) {
    candidate = ogTitle;
  } else {
    for (const delimiter of ["|", "-", "_", "/", " » "]) {
      if (!candidate.includes(delimiter)) continue;
      const parts = candidate
        .split(delimiter)
        .map((part) => cleanText(part))
        .filter(Boolean)
        .sort((a, b) =>
          h1 && normalized(a).includes(normalized(h1))
            ? -1
            : b.length - a.length,
        );
      candidate = parts[0] ?? candidate;
      break;
    }
  }

  return candidate.replace("&#65533;", "").trim().slice(0, config.maxTitle);
};

export const extractMeta = (document: Document, articleUrl: string) => {
  const htmlLang = attr(document.documentElement, "lang");
  const metaLanguage = [
    'meta[property="og:locale"]',
    'meta[http-equiv="content-language"]',
    'meta[name="lang"]',
  ]
    .map((selector) => attr(document.querySelector(selector), "content"))
    .find(Boolean);
  const language = normalizeLanguageCode(
    (htmlLang ?? metaLanguage ?? "").slice(0, 3),
  );

  const canonical =
    attr(document.querySelector('link[rel="canonical"]'), "href") ??
    attr(document.querySelector('meta[property="og:url"]'), "content") ??
    articleUrl;

  const description =
    attr(document.querySelector('meta[name="description"]'), "content") ??
    attr(
      document.querySelector('meta[property="og:description"]'),
      "content",
    ) ??
    "";

  const siteName =
    attr(document.querySelector('meta[property="og:site_name"]'), "content") ??
    "";

  const keywordsRaw =
    attr(document.querySelector('meta[name="keywords"]'), "content") ?? "";
  const keywords = keywordsRaw
    .split(",")
    .map((value) => cleanText(value))
    .filter(Boolean);

  const data: Record<string, JsonValue> = {};
  for (const meta of queryAll(document, "meta")) {
    const key = attr(meta, "property") ?? attr(meta, "name");
    const value = attr(meta, "content") ?? attr(meta, "value");
    if (key && value) {
      data[key] = value;
    }
  }

  const tags = new Set<string>();
  for (const node of queryAll(
    document,
    'a[rel="tag"], a[href*="/tag/"], a[href*="/topic/"]',
  )) {
    const value = cleanText(textOf(node));
    if (value) tags.add(value);
  }

  return {
    language: /^[a-z]{2}$/i.test(language) ? language.toLowerCase() : null,
    type:
      attr(document.querySelector('meta[property="og:type"]'), "content") ??
      null,
    canonicalLink: absoluteUrl(canonical, articleUrl),
    siteName,
    description,
    keywords,
    tags: Array.from(tags),
    data,
  };
};

export const extractAuthors = (document: Document) => {
  const authors: string[] = [];
  for (const item of collectJsonLd(document)) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, JsonValue>;
    const graph = Array.isArray(record["@graph"]) ? record["@graph"] : [record];
    for (const graphItem of graph) {
      if (!graphItem || typeof graphItem !== "object") continue;
      const author = (graphItem as Record<string, JsonValue>).author;
      const pushName = (value: JsonValue | undefined) => {
        if (typeof value === "string") authors.push(cleanText(value));
        if (value && typeof value === "object" && !Array.isArray(value)) {
          const name = (value as Record<string, JsonValue>).name;
          if (typeof name === "string") authors.push(cleanText(name));
        }
        if (Array.isArray(value)) {
          for (const entry of value) {
            pushName(entry);
          }
        }
      };
      pushName(author);
      if ((graphItem as Record<string, JsonValue>)["@type"] === "Person") {
        const name = (graphItem as Record<string, JsonValue>).name;
        if (typeof name === "string") authors.push(cleanText(name));
      }
    }
  }

  for (const attrName of AUTHOR_ATTRS) {
    for (const value of AUTHOR_VALS) {
      for (const node of queryAll(
        document,
        `[${attrName}="${value}"], meta[${attrName}="${value}"]`,
      )) {
        const content =
          attr(node, "content") ??
          cleanText(textOf(node).replace(/<[^>]+>/g, " "));
        for (const token of content
          .replace(/\b(by|from)[:\s]/gi, "")
          .split(/[·,|/]| and | et | und /i)
          .map((entry) => cleanText(entry))
          .filter(
            (entry) =>
              !/\d/.test(entry) &&
              entry.split(/\s+/).length > 1 &&
              entry.split(/\s+/).length < 5,
          )) {
          authors.push(token);
        }
      }
    }
  }

  const stopwordRegex = new RegExp(
    `\\b(${AUTHOR_STOP_WORDS.join("|")})\\b`,
    "gi",
  );
  return Array.from(
    new Map(
      authors
        .map((author) =>
          author
            .replace(stopwordRegex, "")
            .trim()
            .replace(/^[\s.,/-]+|[\s.,/-]+$/g, ""),
        )
        .filter(Boolean)
        .map((author) => [author.toLowerCase(), author] as const),
    ).values(),
  );
};

const tryParseDate = (value: string | null | undefined) => {
  if (!value) return null;
  const parsed = chrono.parseDate(value) ?? new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const extractPublishDate = (document: Document, articleUrl: string) => {
  const candidates: Array<{ readonly date: Date; readonly score: number }> = [];
  const urlDateParts = articleUrl.match(
    /(?<year>(?:19|20)\d{2})[/\-_.](?<month>\d{1,2})[/\-_.](?<day>\d{1,2})/,
  )?.groups;
  const parsedUrlDate = urlDateParts
    ? new Date(
        Date.UTC(
          Number(urlDateParts.year),
          Number(urlDateParts.month) - 1,
          Number(urlDateParts.day),
        ),
      )
    : tryParseDate(
        articleUrl.match(
          /(?:19|20)\d{2}[/\-_.\s](?:\d{1,2}|\w{3,5})[/\-_.\s]\d{1,2}/,
        )?.[0],
      );
  if (parsedUrlDate) candidates.push({ date: parsedUrlDate, score: 10 });

  for (const item of collectJsonLd(document)) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, JsonValue>;
    const graph = Array.isArray(record["@graph"]) ? record["@graph"] : [record];
    for (const graphItem of graph) {
      if (!graphItem || typeof graphItem !== "object") continue;
      const maybeDate =
        (graphItem as Record<string, JsonValue>).datePublished ??
        (graphItem as Record<string, JsonValue>).dateCreated;
      const parsed =
        typeof maybeDate === "string" ? tryParseDate(maybeDate) : null;
      if (parsed) candidates.push({ date: parsed, score: 9 });
    }
  }

  for (const node of queryAll(document, "time")) {
    const parsed = tryParseDate(attr(node, "datetime") ?? textOf(node));
    if (parsed) candidates.push({ date: parsed, score: 8 });
  }

  for (const key of PUBLISH_DATE_META_INFO) {
    for (const node of queryAll(
      document,
      `meta[name="${key}"], meta[property="${key}"]`,
    )) {
      const parsed = tryParseDate(attr(node, "content"));
      if (parsed) candidates.push({ date: parsed, score: 7 });
    }
  }

  return candidates.sort((a, b) => b.score - a.score)[0]?.date ?? null;
};

const getLinkDensity = (node: Element, language: string) => {
  const stopwords = new StopWords(language);
  const text = textOf(node);
  if (!text) return 0;
  const linkText = queryAll(node, "a")
    .map((link) => textOf(link))
    .join(" ");
  const words = stopwords.getStopwordCount(text).wordCount || 1;
  const linkWords = stopwords.getStopwordCount(linkText).wordCount;
  return linkWords / words;
};

const scoreNode = (node: Element, language: string) => {
  const stopwords = new StopWords(language);
  const content = textOf(node);
  const stats = stopwords.getStopwordCount(content);
  if (stats.stopWordCount <= 2 || getLinkDensity(node, language) > 0.6) {
    return null;
  }
  let score = stats.stopWordCount;
  for (const boost of ARTICLE_BODY_TAGS) {
    if (node.matches(boost.selector)) {
      score += boost.score;
    }
  }
  if (
    BAD_NODE_PATTERNS.test(attr(node, "class") ?? "") ||
    BAD_NODE_PATTERNS.test(attr(node, "id") ?? "")
  ) {
    score -= 25;
  }
  return score;
};

const removeBadNodes = (document: Document) => {
  removeNodes(
    queryAll(document, "script, style, noscript, aside, nav, menu, footer"),
  );
  removeNodes(
    queryAll(document, "*").filter((node) => {
      const className = attr(node, "class") ?? "";
      const id = attr(node, "id") ?? "";
      return BAD_NODE_PATTERNS.test(className) || BAD_NODE_PATTERNS.test(id);
    }),
  );
};

const complementNode = (node: Element | null, language: string) => {
  if (!node?.parentElement) return node;
  const clone = node.cloneNode(true) as Element;
  for (const sibling of Array.from(node.parentElement.children)) {
    if (sibling === node) continue;
    if (sibling.tagName.toLowerCase() !== "p") continue;
    const stats = new StopWords(language).getStopwordCount(textOf(sibling));
    if (stats.stopWordCount > 5 && getLinkDensity(sibling, language) < 0.4) {
      clone.appendChild(sibling.cloneNode(true));
    }
  }
  return clone;
};

const blockLevelTags = new Set([
  "article",
  "blockquote",
  "div",
  "figure",
  "figcaption",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "ul",
  "video",
]);

const toText = (node: Node, title?: string): string => {
  const parts: string[] = [];
  const walk = (current: Node) => {
    if (current.nodeType === current.TEXT_NODE) {
      const value = cleanText(current.textContent ?? "");
      if (value) parts.push(value);
      return;
    }
    if (current.nodeType !== 1) {
      return;
    }
    const element = current as Element;
    if (element.tagName.toLowerCase() === "br") {
      parts.push("\n\n");
      return;
    }
    const before = parts.length;
    for (const child of Array.from(element.childNodes)) {
      walk(child);
    }
    if (
      blockLevelTags.has(element.tagName.toLowerCase()) &&
      parts.length > before
    ) {
      parts.push("\n\n");
    }
  };
  walk(node);
  const baseText = parts
    .join(" ")
    .replace(/(?:\s*\n\s*){2,}/g, "\n\n")
    .replace(/[ \t]+/g, " ")
    .trim();
  const filteredParagraphs = (
    baseText ? baseText.split(/\n{2,}/).filter(Boolean) : []
  ).filter(
    (paragraph, index) =>
      !(index === 0 && paragraph.length < 50 && /[—-]$/.test(paragraph)),
  );
  if (!title) return filteredParagraphs.join("\n\n");
  if (
    filteredParagraphs.length > 0 &&
    normalized(filteredParagraphs[0] ?? "") === normalized(title)
  ) {
    return filteredParagraphs.slice(1).join("\n\n");
  }
  if (
    filteredParagraphs.length > 1 &&
    (filteredParagraphs[0]?.length ?? 0) < 200 &&
    normalized(filteredParagraphs[1] ?? "") === normalized(title)
  ) {
    return filteredParagraphs.slice(2).join("\n\n");
  }
  return filteredParagraphs.join("\n\n");
};

export const extractArticleBody = (
  document: Document,
  language: string,
  title?: string,
) => {
  const cloned = document.cloneNode(true) as Document;
  removeBadNodes(cloned);
  const candidates = queryAll(cloned, "article, div, p, pre, td");
  const scored = candidates
    .map((node) => ({ node, score: scoreNode(node, language) }))
    .filter(
      (entry): entry is { node: Element; score: number } =>
        entry.score !== null,
    )
    .sort((a, b) => b.score - a.score);
  const topNode = scored[0]?.node ?? cloned.body ?? cloned.documentElement;
  const complemented = complementNode(topNode, language) ?? topNode;
  return {
    topNode,
    topNodeComplemented: complemented,
    articleHtml: serializeNode(complemented),
    text: toText(complemented, title),
  };
};

export const extractVideos = (
  document: Document,
  topNode: Element | null,
): Video[] => {
  const providers = [
    "youtube",
    "youtu.be",
    "vimeo",
    "dailymotion",
    "kewego",
    "twitch",
  ];
  const videos = new Map<string, Video>();
  const root = topNode ?? document;

  for (const node of queryAll(root, "iframe, embed, object, video")) {
    const src =
      attr(node, "data-litespeed-src") ??
      attr(node, "src") ??
      attr(node.querySelector('param[name="movie"]'), "value");
    if (!src) continue;
    videos.set(src, {
      src,
      embedCode: serializeNode(node),
      embedType: node.tagName.toLowerCase(),
      width: Number(attr(node, "width")) || null,
      height: Number(attr(node, "height")) || null,
      provider: providers.find((provider) => src.includes(provider)) ?? null,
    });
  }

  for (const item of collectJsonLd(document)) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, JsonValue>;
    if (record["@type"] === "VideoObject") {
      const src =
        typeof record.contentUrl === "string" ? record.contentUrl : null;
      if (src) {
        videos.set(src, {
          src,
          embedCode:
            typeof record.embedUrl === "string" ? record.embedUrl : null,
          embedType: "json-ld",
          width: null,
          height: null,
          provider:
            providers.find((provider) => src.includes(provider)) ?? null,
        });
      }
    }
  }

  return Array.from(videos.values());
};

export const extractImages = async (
  document: Document,
  topNode: Element | null,
  articleUrl: string,
  config: Configuration,
  fetchBytes: (url: string, referer: string) => Promise<Uint8Array | null>,
) => {
  const favicon =
    attr(document.querySelector('link[rel*="icon"]'), "href") ?? "";
  const metaImage =
    META_IMAGE_SELECTORS.map((selector) => {
      const node = document.querySelector(selector);
      return attr(
        node,
        node?.tagName.toLowerCase() === "link" ? "href" : "content",
      );
    }).find(Boolean) ?? "";

  const images = Array.from(
    new Set(
      queryAll(document, "img")
        .map((image) => {
          const candidates = Object.keys(
            (image as HTMLElement).attributes ?? {},
          ).map(() => null);
          void candidates;
          return (
            attr(image, "src") ??
            attr(image, "data-src") ??
            attr(image, "data-original")
          );
        })
        .filter((value): value is string => Boolean(value))
        .filter((value) => !value.startsWith("data:"))
        .map((value) => absoluteUrl(value, articleUrl)),
    ),
  );

  const allCandidates = [absoluteUrl(metaImage, articleUrl), ...images].filter(
    Boolean,
  );

  let topImage = allCandidates[0] ?? "";
  if (config.fetchImages) {
    for (const candidate of allCandidates) {
      const bytes = await fetchBytes(candidate, articleUrl);
      if (!bytes) continue;
      try {
        const size = imageSize(Buffer.from(bytes));
        const width = size.width ?? 0;
        const height = size.height ?? 0;
        if (
          width >= config.topImageSettings.minWidth &&
          height >= config.topImageSettings.minHeight &&
          width * height >= config.topImageSettings.minArea
        ) {
          topImage = candidate;
          break;
        }
      } catch {}
    }
  }

  if (!topImage && topNode) {
    const localImage = topNode.querySelector("img");
    if (localImage) {
      topImage = absoluteUrl(attr(localImage, "src") ?? "", articleUrl);
    }
  }

  return {
    favicon,
    metaImage: metaImage ? absoluteUrl(metaImage, articleUrl) : "",
    images,
    topImage,
  };
};

export const extractCategoryUrls = (sourceUrl: string, document: Document) => {
  const urls = new Set<string>();
  for (const anchor of queryAll(document, "a[href]")) {
    const href = attr(anchor, "href");
    if (!href) continue;
    const prepared = prepareUrl(href, sourceUrl);
    if (prepared && !validUrl(prepared)) {
      const parsed = new URL(prepared);
      const chunks = parsed.pathname.split("/").filter(Boolean);
      if (chunks.length === 1 || chunks.length === 2) {
        urls.add(prepared.replace(/\/$/, ""));
      }
    }
  }
  urls.add(prepareUrl("/", sourceUrl));
  return Array.from(urls).sort();
};

export const extractFeedUrls = (
  sourceUrl: string,
  documents: ReadonlyArray<Document>,
) => {
  const feeds = new Set<string>();
  for (const document of documents) {
    for (const node of queryAll(
      document,
      'link[type="application/rss+xml"], a[type="application/rss+xml"], link[href*="rss"], a[href*="rss"], a[href*="/feed"]',
    )) {
      const href = attr(node, "href");
      if (href) {
        feeds.add(prepareUrl(href, sourceUrl));
      }
    }
  }
  return Array.from(feeds);
};

export const extractArticleLinks = (document: Document, baseUrl: string) =>
  queryAll(document, "a[href]")
    .map((node) => ({
      url: prepareUrl(attr(node, "href") ?? "", baseUrl),
      title: cleanText(textOf(node)),
    }))
    .filter((entry) => validUrl(entry.url));
