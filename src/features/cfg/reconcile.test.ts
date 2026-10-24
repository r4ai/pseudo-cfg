import { describe, expect, it } from "vitest";
import { buildCfg } from "./build-cfg";
import { reconcile } from "./reconcile";

const counter = () => {
  let n = 0;
  return () => `new${n++}`;
};

describe("reconcile", () => {
  const base = reconcile(
    { nodes: [], edges: [] },
    buildCfg("if a:\n    x()\ny()", "statement").cfg,
    counter(),
  );
  const idOf = (cfg: typeof base, label: string) => cfg.nodes.find((n) => n.label === label)?.id;

  it("keeps ids of unchanged nodes when a statement is inserted", () => {
    const next = reconcile(base, buildCfg("if a:\n    x()\n    z()\ny()", "statement").cfg, counter());
    expect(idOf(next, "if a")).toBe(idOf(base, "if a"));
    expect(idOf(next, "x()")).toBe(idOf(base, "x()"));
    expect(idOf(next, "y()")).toBe(idOf(base, "y()"));
    expect(idOf(next, "z()")).toBe("new0");
  });

  it("treats an edited node as the same node", () => {
    const next = reconcile(base, buildCfg("if b:\n    x()\ny()", "statement").cfg, counter());
    expect(idOf(next, "if b")).toBe(idOf(base, "if a"));
  });

  it("rewrites edge endpoints to the reconciled ids", () => {
    const next = reconcile(base, buildCfg("if a:\n    x()\ny()", "statement").cfg, counter());
    const ids = new Set(next.nodes.map((n) => n.id));
    expect(next.edges.every((e) => ids.has(e.source) && ids.has(e.target))).toBe(true);
  });
});
