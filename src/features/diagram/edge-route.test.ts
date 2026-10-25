import { describe, expect, it } from "vitest";
import { arrowhead, roundedPath, routeEdge, shortLabel, toneOf, verticalLanes } from "./edge-route";

const box = (x: number, y: number, width = 100, height = 40) => ({ x, y, width, height });

describe("routeEdge", () => {
  it("connects a node straight down to the node below it", () => {
    const { points } = routeEdge(box(0, 0), box(0, 100), []);
    expect(points).toEqual([
      { x: 50, y: 40 },
      { x: 50, y: 100 },
    ]);
  });

  it("always takes a False exit from the right vertex", () => {
    const right = routeEdge(box(0, 0), box(200, 100), [], { exit: "no" });
    expect(right.points[0]).toEqual({ x: 100, y: 20 });
    expect(right.points.at(-1)).toEqual({ x: 250, y: 100 });
    const left = routeEdge(box(200, 0), box(0, 100), [], { exit: "no" });
    expect(left.points[0]).toEqual({ x: 300, y: 20 });
  });

  it("always takes a True exit from the bottom", () => {
    const { points } = routeEdge(box(0, 0), box(200, 100), [], { exit: "yes" });
    expect(points[0]).toEqual({ x: 50, y: 40 });
  });

  it("goes round nodes in the way on the right", () => {
    const body = box(0, 80, 100, 40);
    for (const exit of ["yes", "no", "plain"] as const) {
      const { points } = routeEdge(box(0, 0), box(0, 160), [body], { exit });
      expect(Math.max(...points.map((p) => p.x))).toBeGreaterThan(body.x + body.width);
    }
  });

  it("steps a detour past lanes other edges use", () => {
    const body = box(0, 80, 100, 40);
    const first = routeEdge(box(0, 0), box(0, 160), [body], { exit: "no" });
    const second = routeEdge(box(0, 0), box(0, 160), [body], {
      exit: "no",
      lanes: verticalLanes(first.points),
    });
    expect(Math.max(...second.points.map((p) => p.x))).toBeGreaterThan(
      Math.max(...first.points.map((p) => p.x)),
    );
  });

  it("runs a loop back edge up on the left of the nodes it passes", () => {
    const obstacle = box(0, 60, 300);
    const { points } = routeEdge(box(0, 120), box(0, 0), [obstacle], { back: true });
    expect(Math.min(...points.map((p) => p.x))).toBeLessThan(obstacle.x);
    expect(points.at(-1)).toEqual({ x: 50, y: 0 });
  });
});

describe("toneOf", () => {
  it("groups labels by outcome", () => {
    expect(["True", "next", "False", "done", "raise", null].map(toneOf)).toEqual([
      "yes",
      "yes",
      "no",
      "no",
      "no",
      "plain",
    ]);
  });
});

describe("shortLabel", () => {
  it("shortens branch outcomes and keeps other labels", () => {
    expect(["True", "False", "next", "done", "raise"].map(shortLabel)).toEqual([
      "T",
      "F",
      "next",
      "done",
      "raise",
    ]);
  });
});

describe("roundedPath", () => {
  const line = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
  ];
  it("hops over each crossing", () => {
    const d = roundedPath(line, 8, [{ x: 30, y: 0 }]);
    expect(d).toBe("M 0 0 L 24 0 A 6 6 0 0 1 36 0 L 100 0");
  });

  it("joins crossings too close for separate hops into one, never doubling back", () => {
    const d = roundedPath(line, 8, [
      { x: 50, y: 0 },
      { x: 45, y: 0 },
    ]);
    expect(d).toBe("M 0 0 L 39 0 A 8.5 6 0 0 1 56 0 L 100 0");
  });

  it("shrinks a hop that is close to the end of the line", () => {
    const d = roundedPath(line, 8, [{ x: 96, y: 0 }]);
    expect(d).toBe("M 0 0 L 93 0 A 3 3 0 0 1 99 0 L 100 0");
  });
});

describe("arrowhead", () => {
  it("trims the line so it ends at the arrow's base", () => {
    const { line } = arrowhead([
      { x: 0, y: 0 },
      { x: 0, y: 100 },
    ]);
    expect(line.at(-1)).toEqual({ x: 0, y: 90 });
  });
});
