import { describe, expect, it } from "vitest";
import { sharedSource, shareUrl } from "./share";

describe("share links", () => {
  it("round-trips code, including non-ASCII text", () => {
    const source = 'def f(x):\n    return "日本語 ✓" + x\n';
    const url = new URL(shareUrl(source, "https://example.com/"));
    expect(url.hash.startsWith("#code=")).toBe(true);
    expect(sharedSource(url.hash)).toBe(source);
  });

  it("ignores fragments that are not share links or are corrupt", () => {
    expect(sharedSource("")).toBeNull();
    expect(sharedSource("#other")).toBeNull();
    expect(sharedSource("#code=%%%")).toBeNull();
  });
});
