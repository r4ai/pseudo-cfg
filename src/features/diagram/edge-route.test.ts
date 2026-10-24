import { describe, expect, it } from "vitest";
import { arrowhead, routeEdge } from "./edge-route";

const box = (x: number, y: number, width = 100, height = 40) => ({ x, y, width, height });

describe("routeEdge", () => {
  it("connects a node straight down to the node below it", () => {
    const { points } = routeEdge(box(0, 0), box(0, 100), false, []);
    expect(points).toEqual([
      { x: 50, y: 40 },
      { x: 50, y: 100 },
    ]);
  });

  it("leaves a branch through the side vertex facing an off-center target", () => {
    const { points } = routeEdge(box(0, 0), box(200, 100), true, []);
    expect(points[0]).toEqual({ x: 100, y: 20 });
    expect(points.at(-1)).toEqual({ x: 250, y: 100 });
  });

  it("moves a branch's side lane past a node below it", () => {
    const blocker = box(90, 80, 100, 40);
    const { points } = routeEdge(box(0, 0), box(60, 200, 40), true, [blocker]);
    const laneX = points[1]?.x ?? 0;
    expect(laneX).toBeGreaterThan(blocker.x + blocker.width);
  });

  it("routes a back edge outside the nodes it passes", () => {
    const obstacle = box(0, 60, 300);
    const { points } = routeEdge(box(0, 120), box(0, 0), false, [obstacle]);
    const laneX = Math.max(...points.map((p) => p.x));
    expect(laneX).toBeGreaterThan(obstacle.x + obstacle.width);
    expect(points.at(-1)).toEqual({ x: 50, y: 0 });
  });
});

describe("routeEdge from a branch", () => {
  it("leaves a loop back edge through a side vertex, keeping the bottom free", () => {
    const { points } = routeEdge(box(0, 120), box(0, 0), true, []);
    expect(points[0]).toEqual({ x: 100, y: 140 });
  });
});

describe("arrowhead", () => {
  it("trims the line so it ends at the arrow's base", () => {
    const { line } = arrowhead([
      { x: 0, y: 0 },
      { x: 0, y: 100 },
    ]);
    expect(line.at(-1)).toEqual({ x: 0, y: 91 });
  });
});
