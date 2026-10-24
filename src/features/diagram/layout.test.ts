import { describe, expect, it } from "vitest";
import { buildCfg } from "@/features/cfg/build-cfg";
import { reconcile } from "@/features/cfg/reconcile";
import { autoLayout, displayLines, nodeSize, placeIncrementally } from "./layout";

const counter = () => {
  let n = 0;
  return () => `id${n++}`;
};

describe("placeIncrementally with a new scope", () => {
  it("places a new scope beside the existing graph instead of over it", () => {
    const prev = reconcile(
      { nodes: [], edges: [] },
      buildCfg("def f():\n    a()\n    b()", "block").cfg,
      counter(),
    );
    const layout = autoLayout(prev);
    let k = 0;
    const next = reconcile(
      prev,
      buildCfg("def f():\n    a()\n    b()\nfoo()", "block").cfg,
      () => `new${k++}`,
    );
    const positions = placeIncrementally(prev, layout, next);
    for (const node of prev.nodes) expect(positions[node.id]).toEqual(layout[node.id]);
    const right = Math.max(...prev.nodes.map((n) => (layout[n.id]?.x ?? 0) + nodeSize(n).width));
    const added = next.nodes.filter((n) => n.id.startsWith("new"));
    expect(added).toHaveLength(3);
    for (const node of added) expect(positions[node.id]?.x).toBeGreaterThan(right);
  });
});

describe("placeIncrementally", () => {
  it("keeps a new node above the node it flows into", () => {
    const src = "def f(xs):\n    for x in xs:\n        g(x)";
    const prev = reconcile({ nodes: [], edges: [] }, buildCfg(src, "block").cfg, counter());
    let k = 0;
    const next = reconcile(prev, buildCfg(`${src}\n    return s`, "block").cfg, () => `new${k++}`);
    const positions = placeIncrementally(prev, autoLayout(prev), next);
    const added = next.nodes.find((n) => n.label === "return s");
    const end = next.nodes.find((n) => n.kind === "end");
    if (!added || !end) throw new Error("nodes missing");
    expect(positions[end.id]?.y).toBeGreaterThanOrEqual(
      (positions[added.id]?.y ?? 0) + nodeSize(added).height,
    );
  });

  const prev = reconcile({ nodes: [], edges: [] }, buildCfg("a()\nb()\nc()", "statement").cfg, counter());
  const moved = { ...autoLayout(prev) };
  const idOf = (label: string, cfg = prev) => cfg.nodes.find((n) => n.label === label)?.id as string;
  moved[idOf("b()")] = { x: 500, y: 123 };

  it("keeps positions of surviving nodes, including manually moved ones", () => {
    const next = reconcile(prev, buildCfg("a()\nb()\nc()\nd()", "statement").cfg, () => "fresh");
    const positions = placeIncrementally(prev, moved, next);
    expect(positions[idOf("b()")]).toEqual({ x: 500, y: 123 });
    expect(positions[idOf("a()")]).toEqual(moved[idOf("a()")]);
  });

  it("pushes following nodes down to make room for an inserted node", () => {
    const layout = autoLayout(prev);
    const next = reconcile(prev, buildCfg("a()\nnew()\nb()\nc()", "statement").cfg, () => "fresh");
    const positions = placeIncrementally(prev, layout, next);
    const inserted = positions.fresh;
    const insertedNode = next.nodes.find((n) => n.label === "new()");
    if (!insertedNode) throw new Error("inserted node missing");
    const below = positions[idOf("b()")];
    expect(inserted).toBeDefined();
    expect(below?.y).toBeGreaterThanOrEqual((inserted?.y ?? 0) + nodeSize(insertedNode).height);
    expect(positions[idOf("a()")]).toEqual(layout[idOf("a()")]);
  });
});

const node = (label: string) => ({ id: "n", kind: "block" as const, label, line: 1, endLine: 1 });

describe("nodeSize", () => {
  it("grows a start node to fit a wrapped signature", () => {
    const start = {
      id: "s",
      kind: "start" as const,
      label: `def f(${"arg, ".repeat(30)})`,
      line: 1,
      endLine: 1,
    };
    expect(nodeSize(start).height).toBe(displayLines(start.label).length * 20 + 16);
  });

  it("gives wide characters two columns", () => {
    expect(nodeSize(node("日本語の長い文字列")).width).toBe(nodeSize(node("x".repeat(18))).width);
  });
});

describe("displayLines", () => {
  it("wraps long lines at a space and keeps short ones", () => {
    const long = `result = compute(${"argument, ".repeat(8)}last)`;
    const lines = displayLines(`short\n${long}`);
    expect(lines[0]).toBe("short");
    expect(lines.length).toBeGreaterThan(2);
    expect(lines.join(" ").replaceAll(/\s+/g, " ")).toBe(`short ${long}`.replaceAll(/\s+/g, " "));
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(56);
  });
});

describe("placeIncrementally when a node grows", () => {
  it("leaves hand-placed successors where they are", () => {
    const prev = reconcile({ nodes: [], edges: [] }, buildCfg("a()\nb()\nc()", "statement").cfg, counter());
    const layout = autoLayout(prev);
    const id = (label: string) => prev.nodes.find((n) => n.label === label)?.id as string;
    const a = layout[id("a()")] ?? { x: 0, y: 0 };
    const moved = { ...layout, [id("b()")]: { x: a.x + 400, y: a.y }, [id("c()")]: { x: a.x + 800, y: a.y } };
    const next = reconcile(
      prev,
      buildCfg("a(1234567890123456789)\nb()\nc()", "statement").cfg,
      () => "fresh",
    );
    const positions = placeIncrementally(prev, moved, next);
    expect(positions[id("b()")]).toEqual(moved[id("b()")]);
    expect(positions[id("c()")]).toEqual(moved[id("c()")]);
  });
});
