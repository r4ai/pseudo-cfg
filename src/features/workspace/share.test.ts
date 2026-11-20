import { describe, expect, it } from "vitest";
import { sharedSource, sharedSpec, shareSpecUrl, shareUrl } from "./share";

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

  it("round-trips declarative YAML specs via #spec= links", () => {
    const yaml =
      'language: python\nsource: |\n  print("日本語")\nlayout:\n  nodes:\n    n2: { x: 100, y: 200 }\n';
    const url = new URL(shareSpecUrl(yaml, "https://example.com/"));
    expect(url.hash.startsWith("#spec=")).toBe(true);
    expect(sharedSpec(url.hash)).toBe(yaml);
    expect(sharedSource(url.hash)).toBeNull();
  });

  it("ignores fragments that are not share links or are corrupt", () => {
    expect(sharedSource("")).toBeNull();
    expect(sharedSource("#other")).toBeNull();
    expect(sharedSource("#code=%%%")).toBeNull();
    expect(sharedSource("#code=YQ&lang=cobol")).toBeNull();
    expect(sharedSpec("")).toBeNull();
    expect(sharedSpec("#code=YQ")).toBeNull();
    expect(sharedSpec("#spec=%%%")).toBeNull();
  });
});
