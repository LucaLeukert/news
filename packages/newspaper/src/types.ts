export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | ReadonlyArray<JsonValue>
  | { readonly [key: string]: JsonValue };

export type WordStats = {
  readonly stopWordCount: number;
  readonly wordCount: number;
  readonly stopWords: ReadonlyArray<string>;
};

export type Video = {
  readonly src: string | null;
  readonly embedCode: string | null;
  readonly embedType: string | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly provider: string | null;
};

export type ArticleJson = {
  readonly url: string;
  readonly read_more_link: string;
  readonly language: string;
  readonly title: string;
  readonly top_image: string;
  readonly meta_img: string;
  readonly images: ReadonlyArray<string>;
  readonly movies: ReadonlyArray<string>;
  readonly keywords: ReadonlyArray<string>;
  readonly meta_keywords: ReadonlyArray<string>;
  readonly tags: ReadonlyArray<string>;
  readonly authors: ReadonlyArray<string>;
  readonly publish_date: string | null;
  readonly summary: string;
  readonly meta_description: string;
  readonly meta_lang: string;
  readonly meta_favicon: string;
  readonly meta_site_name: string;
  readonly canonical_link: string;
  readonly text: string;
  readonly text_cleaned: string;
};

export type Category = {
  readonly url: string;
  html: string | null;
  doc: Document | null;
};

export type Feed = {
  readonly url: string;
  rss: string | null;
  title?: string;
};
