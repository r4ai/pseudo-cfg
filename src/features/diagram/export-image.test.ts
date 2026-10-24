import { describe, expect, it } from "vitest";
import { buildCfg } from "@/features/cfg/build-cfg";
import { diagramToSvg } from "./export-image";
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
});
