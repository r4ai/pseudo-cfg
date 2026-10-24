import { describe, expect, it } from "vitest";
import { buildCfg, type Cfg } from "@/features/cfg/build-cfg";
import { EXAMPLES } from "@/features/workspace/sample";
import type { Point } from "./edge-route";
import { nodeBoxes, routeEdges } from "./geometry";
import { autoLayout } from "./layout";

const SOURCES = [
  ...EXAMPLES.map((example) => example.source),
  "for i in xs:\n    if i:\n        a()\n    else:\n        b()\n        if c:\n            d()\n    e()\nf()",
  "def f(x):\n    if x is None:\n        return 0\n    y = x * 2\n    if y > 10:\n        y = 10\n    return y",
  "while a:\n    if b:\n        continue\n    if c:\n        break\n    d()\nq()",
];

type Segment = { edge: number; target: string; a: Point; b: Point };

function laidOut(source: string, granularity: "block" | "statement") {
  const { cfg } = buildCfg(source, granularity);
  const boxes = nodeBoxes(cfg, autoLayout(cfg));
  return { cfg, boxes, routed: routeEdges(cfg, boxes) };
}

/** Lengths of collinear overlaps between edges that lead to different nodes. */
function overlaps(routed: ReturnType<typeof routeEdges>): number[] {
  const segments: Segment[] = routed.flatMap((e, edge) =>
    e.geometry.points
      .slice(1)
      .map((b, i) => ({ edge, target: e.target, a: e.geometry.points[i] as Point, b })),
  );
  const horizontal = (s: Segment) => Math.abs(s.a.y - s.b.y) < 0.5;
  const span = (s: Segment, axis: "x" | "y") => [
    Math.min(s.a[axis], s.b[axis]),
    Math.max(s.a[axis], s.b[axis]),
  ];
  const found: number[] = [];
  for (const [i, s] of segments.entries()) {
    for (const u of segments.slice(i + 1)) {
      if (s.edge === u.edge || s.target === u.target || horizontal(s) !== horizontal(u)) continue;
      const [along, across] = horizontal(s) ? (["x", "y"] as const) : (["y", "x"] as const);
      if (Math.abs(s.a[across] - u.a[across]) >= 3) continue;
      const [s0, s1] = span(s, along);
      const [u0, u1] = span(u, along);
      const overlap = Math.min(s1 as number, u1 as number) - Math.max(s0 as number, u0 as number);
      if (overlap > 2) found.push(overlap);
    }
  }
  return found;
}

function throughNodes(cfg: Cfg, routed: ReturnType<typeof routeEdges>, boxes: ReturnType<typeof nodeBoxes>) {
  let count = 0;
  for (const e of routed) {
    for (const [i, b] of e.geometry.points.slice(1).entries()) {
      const a = e.geometry.points[i] as Point;
      for (const node of cfg.nodes) {
        const o = boxes.get(node.id);
        if (!o || node.id === e.source || node.id === e.target) continue;
        const hit =
          Math.min(a.x, b.x) < o.x + o.width - 1 &&
          o.x + 1 < Math.max(a.x, b.x) &&
          Math.min(a.y, b.y) < o.y + o.height - 1 &&
          o.y + 1 < Math.max(a.y, b.y);
        if (hit) count++;
      }
    }
  }
  return count;
}

describe("routing quality", () => {
  for (const [index, source] of SOURCES.entries()) {
    for (const granularity of ["block", "statement"] as const) {
      it(`keeps edges apart and out of nodes (case ${index}, ${granularity})`, () => {
        const { cfg, boxes, routed } = laidOut(source, granularity);
        expect(overlaps(routed)).toEqual([]);
        expect(throughNodes(cfg, routed, boxes)).toBe(0);
      });
    }
  }
});

describe("structured layout", () => {
  it("puts the True path below a condition and the False path to its right", () => {
    const { cfg, boxes } = laidOut("if a:\n    x()\nelse:\n    y()\nz()", "block");
    const center = (label: string) => {
      const node = cfg.nodes.find((n) => n.label === label);
      const box = node && boxes.get(node.id);
      if (!box) throw new Error(`missing ${label}`);
      return { x: box.x + box.width / 2, y: box.y };
    };
    expect(center("x()").x).toBe(center("if a").x);
    expect(center("x()").y).toBeGreaterThan(center("if a").y);
    expect(center("y()").x).toBeGreaterThan(center("if a").x);
  });

  it("labels True on the bottom vertex and False on the right vertex", () => {
    const { boxes, routed } = laidOut("while a:\n    if b:\n        continue\n    c()", "block");
    const starts = routed
      .filter((e) => e.label === "True" || e.label === "False")
      .map((e) => {
        const box = boxes.get(e.source);
        const start = e.geometry.points[0];
        if (!box || !start) throw new Error("missing geometry");
        const vertex = e.label === "True" ? "bottom" : "right";
        const at =
          start.x === box.x + box.width / 2 && start.y === box.y + box.height
            ? "bottom"
            : start.x === box.x + box.width && start.y === box.y + box.height / 2
              ? "right"
              : "other";
        return [vertex, at];
      });
    expect(starts.length).toBeGreaterThan(0);
    for (const [expected, actual] of starts) expect(actual).toBe(expected);
  });
});
