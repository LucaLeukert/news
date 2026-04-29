import { parse as parseDomain } from "tldts";

const DATE_REGEX =
  /(?:[./\-_\s]?(?:19|20)\d{2})[./\-_\s]?(?:[0-3]?[0-9][./\-_\s]|\w{3,5}[./\-_\s])(?:[0-3]?[0-9])(?:[./\-+?]|$)/;

const GOOD_PATHS = new Set([
  "story",
  "article",
  "feature",
  "featured",
  "slides",
  "slideshow",
  "gallery",
  "news",
  "video",
  "media",
  "v",
  "radio",
  "press",
]);

const BAD_CHUNKS = new Set([
  "careers",
  "contact",
  "about",
  "faq",
  "terms",
  "privacy",
  "advert",
  "preferences",
  "feedback",
  "info",
  "browse",
  "howto",
  "account",
  "subscribe",
  "donate",
  "shop",
  "admin",
  "auth_user",
  "blog",
  "services",
]);

const BAD_DOMAINS = new Set([
  "amazon",
  "doubleclick",
  "twitter",
  "facebook",
  "google",
  "youtube",
  "instagram",
  "pinterest",
]);

const ALLOWED_TYPES = new Set([
  "html",
  "htm",
  "md",
  "rst",
  "aspx",
  "jsp",
  "rhtml",
  "cgi",
  "xhtml",
  "jhtml",
  "asp",
  "shtml",
]);

export const getDomain = (input: string) => {
  try {
    return new URL(input).hostname;
  } catch {
    return null;
  }
};

export const getScheme = (input: string) => {
  try {
    return new URL(input).protocol.replace(":", "");
  } catch {
    return null;
  }
};

export const getPath = (input: string) => {
  try {
    return new URL(input).pathname;
  } catch {
    return "";
  }
};

export const prepareUrl = (url: string, sourceUrl?: string) => {
  try {
    return new URL(url, sourceUrl).toString();
  } catch {
    return url;
  }
};

export const urlToFiletype = (input: string) => {
  const path = getPath(input).replace(/\/$/, "");
  const lastChunk = path.split("/").filter(Boolean).at(-1);
  if (!lastChunk || !lastChunk.includes(".")) {
    return null;
  }
  const extension = lastChunk.split(".").at(-1)?.toLowerCase() ?? null;
  if (!extension) {
    return null;
  }
  return extension.length <= 5 || ALLOWED_TYPES.has(extension)
    ? extension
    : null;
};

export const validUrl = (input: string) => {
  if (!input || input.length < 11) {
    return false;
  }
  if (!/^https?:\/\//i.test(input) || input.includes("mailto:")) {
    return false;
  }

  const path = getPath(input).replace(/\/$/, "");
  if (!path.startsWith("/")) {
    return false;
  }

  const fileType = urlToFiletype(input);
  if (fileType && !ALLOWED_TYPES.has(fileType)) {
    return false;
  }

  const parsed = parseDomain(input);
  if (!parsed.domain || BAD_DOMAINS.has(parsed.domain.toLowerCase())) {
    return false;
  }

  const pathChunks = path
    .split("/")
    .filter(Boolean)
    .map((chunk) => chunk.replace(/\.[^.]+$/, ""))
    .filter((chunk) => chunk !== "index");

  if (pathChunks.length <= 1) {
    return false;
  }

  if (pathChunks.some((chunk) => BAD_CHUNKS.has(chunk.toLowerCase()))) {
    return false;
  }

  const slug = pathChunks.at(-1) ?? "";
  const dashCount = (slug.match(/-/g) ?? []).length;
  const underscoreCount = (slug.match(/_/g) ?? []).length;
  if (slug && (dashCount > 4 || underscoreCount > 4)) {
    return true;
  }

  if (DATE_REGEX.test(input)) {
    return true;
  }

  if (
    /^[0-9]{3,}$/.test(pathChunks.at(-1) ?? "") ||
    /^[0-9]{3,}$/.test(pathChunks.at(-2) ?? "")
  ) {
    return true;
  }

  return pathChunks.some((chunk) => GOOD_PATHS.has(chunk.toLowerCase()));
};
