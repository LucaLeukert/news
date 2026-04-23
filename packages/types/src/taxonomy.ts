import { Schema } from "effect";
import { taxonomyBucketSchema } from "./domain";

export const countryTaxonomySchema = Schema.Struct({
  countryCode: Schema.String.check(Schema.isLengthBetween(2, 2)),
  version: Schema.String,
  buckets: Schema.Array(
    Schema.Struct({
      key: taxonomyBucketSchema,
      label: Schema.String,
      description: Schema.String,
    }),
  ),
});

export type CountryTaxonomy = typeof countryTaxonomySchema.Type;

export const defaultTaxonomyBuckets = [
  {
    key: "insufficient_context",
    label: "Insufficient context",
    description: "No reliable country-specific mapping is available.",
  },
  {
    key: "unrated",
    label: "Unrated",
    description: "The source has not been reviewed.",
  },
  {
    key: "mixed_context",
    label: "Mixed context",
    description:
      "The source spans contexts where a single spectrum is misleading.",
  },
] satisfies CountryTaxonomy["buckets"];
