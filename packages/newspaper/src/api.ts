import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import { Article } from "./article";
import { Configuration, getAvailableLanguages } from "./configuration";
import { extractArticleBody } from "./extractors";
import { parseDocument } from "./dom";
import { popularUrls } from "./resources";
import { Source } from "./source";

const currentDir = dirname(fileURLToPath(import.meta.url));
const miscDir = join(currentDir, "..", "resources", "misc");

export const build = (
  url = "",
  options?: {
    readonly dry?: boolean;
    readonly onlyHomepage?: boolean;
    readonly onlyInPath?: boolean;
    readonly inputHtml?: string;
    readonly config?: Configuration;
  } & Partial<Configuration>,
) => {
  const config = options?.config ?? new Configuration(options);
  const source = new Source(url, "", config);
  if (options?.dry) {
    return Effect.succeed(source);
  }
  return source.build({
    onlyHomepage: options?.onlyHomepage,
    onlyInPath: options?.onlyInPath,
    inputHtml: options?.inputHtml,
  });
};

export const article = (
  url: string,
  language?: string | null,
  options?: Partial<Configuration> & { readonly inputHtml?: string },
) => {
  const config = new Configuration(options);
  if (language) config.language = language;
  const result = new Article(url, "", "", "", config);
  return result.download({ inputHtml: options?.inputHtml }).pipe(
    Effect.flatMap(() => result.parse()),
    Effect.map(() => result),
  );
};

export const fulltext = (html: string, language = "en") => {
  const document = parseDocument(html);
  if (!document) return "";
  return extractArticleBody(document, language).text;
};

export const languages = () => getAvailableLanguages();

export const hot = () =>
  readFileSync(join(miscDir, "google_sources.txt"), "utf8")
    .split("\n")
    .map((value) => value.trim())
    .filter(Boolean);

export { popularUrls };
