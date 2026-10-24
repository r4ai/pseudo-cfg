import { describe, expect, it } from "vitest";
import { buildCfg } from "@/features/cfg/build-cfg";
import { diagramToSvg, pixelRatio } from "./export-image";
import { autoLayout } from "./layout";

describe("diagramToSvg", () => {
  it("renders every node label and escapes markup", () => {
    const { cfg } = buildCfg("if a < b:\n    x = '<tag>'", "block");
    const svg = diagramToSvg(cfg, autoLayout(cfg));
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("if a &#60; b");
    expect(svg).toContain("x = &#39;&#60;tag&#62;&#39;");
    expect(svg).not.toContain("<tag>");
  });

  it("fits loop back edges inside the image", () => {
    const { cfg } = buildCfg("while ready:\n    work()\nafter()", "block");
    const positions = autoLayout(cfg);
    const svg = diagramToSvg(cfg, positions);
    const [x, , width] = (/viewBox="([^"]+)"/.exec(svg)?.[1] ?? "").split(" ").map(Number);
    const right = Math.max(...cfg.nodes.map((n) => positions[n.id]?.x ?? 0));
    expect((x ?? 0) + (width ?? 0)).toBeGreaterThan(right + 140);
  });
});

describe("pixelRatio", () => {
  it("renders small diagrams at 2x and shrinks huge ones to fit a canvas", () => {
    expect(pixelRatio(800, 600)).toBe(2);
    expect(64_000 * pixelRatio(400, 64_000)).toBeLessThanOrEqual(16_384);
  });
});
