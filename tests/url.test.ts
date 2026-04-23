import { describe, expect, it } from "vitest";
import { normalizeUrl, sameRegistrableHost } from "../packages/shared/src";

describe("normalizeUrl", () => {
  it("removes tracking parameters and normalizes host/path", () => {
    expect(
      normalizeUrl("https://www.Example.com/path/?utm_source=x&b=2&a=1#frag"),
    ).toBe("https://example.com/path?a=1&b=2");
  });
});

describe("sameRegistrableHost", () => {
  it("allows canonical URLs on the same publisher host", () => {
    expect(
      sameRegistrableHost("https://www.example.com/a", "https://example.com/b"),
    ).toBe(true);
  });
});
