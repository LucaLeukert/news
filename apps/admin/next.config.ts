import type { NextConfig } from "next";

export default {
  outputFileTracingRoot: new URL("../..", import.meta.url).pathname,
} satisfies NextConfig;
