import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    globals: false,
  },
  resolve: {
    alias: {
      "@news/shared": new URL("./packages/shared/src/index.ts", import.meta.url)
        .pathname,
      "@news/ai": new URL("./packages/ai/src/index.ts", import.meta.url)
        .pathname,
      "@news/crawler-core": new URL(
        "./packages/crawler-core/src/index.ts",
        import.meta.url,
      ).pathname,
    },
  },
});
