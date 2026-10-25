import { describe, expect, it } from "vitest";
import { buildCfg, type Cfg, type Language } from "@/features/cfg/build-cfg";
import { EXAMPLES } from "@/features/workspace/sample";
import { LABEL_HEIGHT, labelWidth, type Point } from "./edge-route";
import { nodeBoxes, routeEdges } from "./geometry";
import { autoLayout } from "./layout";

const SOURCES: (string | { source: string; language: Language })[] = [
  ...EXAMPLES,
  "for i in xs:\n    if i:\n        a()\n    else:\n        b()\n        if c:\n            d()\n    e()\nf()",
  "def f(x):\n    if x is None:\n        return 0\n    y = x * 2\n    if y > 10:\n        y = 10\n    return y",
  "while a:\n    if b:\n        continue\n    if c:\n        break\n    d()\nq()",
  {
    language: "cuda",
    source: "do {\n  if (a) continue;\n  if (b) break;\n  c();\n} while (d);\ne();",
  },
  {
    language: "cuda",
    source: "switch (k) {\ncase 0: a(); break;\ncase 1:\ncase 2: b();\ndefault: c();\n}\nd();",
  },
];

type Segment = { edge: number; target: string; a: Point; b: Point };

function laidOut(input: (typeof SOURCES)[number], granularity: "block" | "statement") {
  const { source, language } = typeof input === "string" ? { source: input, language: undefined } : input;
  const { cfg } = buildCfg(source, granularity, language);
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

const segments = (points: Point[]) => points.slice(1).map((b, i) => [points[i] as Point, b] as const);

/** Crossings between one edge's horizontal and another's vertical that are not drawn as a hop. */
function unhoppedCrossings(routed: ReturnType<typeof routeEdges>): Point[] {
  const missing: Point[] = [];
  for (const [i, e] of routed.entries()) {
    for (const [a, b] of segments(e.geometry.points)) {
      if (Math.abs(a.y - b.y) >= 0.5) continue;
      for (const [j, other] of routed.entries()) {
        if (i === j) continue;
        for (const [c, d] of segments(other.geometry.points)) {
          if (Math.abs(c.x - d.x) >= 0.5) continue;
          const crosses =
            Math.min(a.x, b.x) < c.x &&
            c.x < Math.max(a.x, b.x) &&
            Math.min(c.y, d.y) < a.y &&
            a.y < Math.max(c.y, d.y);
          const hopped = e.geometry.hops.some((h) => Math.abs(h.x - c.x) < 0.5 && Math.abs(h.y - a.y) < 0.5);
          if (crosses && !hopped) missing.push({ x: c.x, y: a.y });
        }
      }
    }
  }
  return missing;
}

/** Labels that cover a node or any part of an edge. */
function coveredLabels(routed: ReturnType<typeof routeEdges>, boxes: ReturnType<typeof nodeBoxes>): string[] {
  return routed.flatMap((e) => {
    if (!e.label) return [];
    const width = labelWidth(e.label);
    const { x, y } = e.geometry.labelAt;
    const label = { x: x - width / 2, y: y - LABEL_HEIGHT / 2, width, height: LABEL_HEIGHT };
    const hits = (o: { x: number; y: number; width: number; height: number }) =>
      label.x < o.x + o.width &&
      o.x < label.x + label.width &&
      label.y < o.y + o.height &&
      o.y < label.y + label.height;
    const onNode = [...boxes.values()].some(hits);
    const onEdge = routed.some((other) =>
      other.geometry.points.slice(1).some((b, i) => {
        const a = other.geometry.points[i] as Point;
        const [x0, x1] = [Math.min(a.x, b.x), Math.max(a.x, b.x)];
        const [y0, y1] = [Math.min(a.y, b.y), Math.max(a.y, b.y)];
        return hits({ x: x0, y: y0, width: x1 - x0, height: y1 - y0 });
      }),
    );
    return onNode || onEdge ? [e.id] : [];
  });
}

describe("routing quality", () => {
  for (const [index, source] of SOURCES.entries()) {
    for (const granularity of ["block", "statement"] as const) {
      it(`keeps edges apart and out of nodes (case ${index}, ${granularity})`, () => {
        const { cfg, boxes, routed } = laidOut(source, granularity);
        expect(overlaps(routed)).toEqual([]);
        expect(throughNodes(cfg, routed, boxes)).toBe(0);
      });

      it(`hops every crossing and keeps labels clear (case ${index}, ${granularity})`, () => {
        const { boxes, routed } = laidOut(source, granularity);
        expect(unhoppedCrossings(routed)).toEqual([]);
        expect(coveredLabels(routed, boxes)).toEqual([]);
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
