import { describe, expect, it } from "vitest";
import { sharedSource, shareUrl } from "./share";

describe("share links", () => {
  it("round-trips code, including non-ASCII text", () => {
    const source = 'def f(x):\n    return "日本語 ✓" + x\n';
    const url = new URL(shareUrl({ source, language: "python" }, "https://example.com/"));
    expect(url.hash.startsWith("#code=")).toBe(true);
    expect(url.hash).not.toContain("lang=");
    expect(sharedSource(url.hash)).toEqual({ source, language: "python" });
  });

  it("carries the language when it is not Python", () => {
    const source = "__global__ void k() { if (a) b(); }";
    const url = new URL(shareUrl({ source, language: "cuda" }, "https://example.com/"));
    expect(sharedSource(url.hash)).toEqual({ source, language: "cuda" });
  });

  it("ignores fragments that are not share links or are corrupt", () => {
    expect(sharedSource("")).toBeNull();
    expect(sharedSource("#other")).toBeNull();
    expect(sharedSource("#code=%%%")).toBeNull();
    expect(sharedSource("#code=YQ&lang=cobol")).toBeNull();
  });
});
