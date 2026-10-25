import { describe, expect, it } from "vitest";
import { buildCfg, type Cfg } from "@/features/cfg/build-cfg";
import type { Box } from "./edge-route";
import { edgeKey, type EdgeOverrides, nodeBoxes, routeEdges } from "./geometry";
import { autoLayout, type Positions } from "./layout";

const { cfg } = buildCfg("if c:\n    a()\nelse:\n    b()\nd()", "statement");
const branch = cfg.nodes.find((n) => n.kind === "branch")?.id as string;
const yes = cfg.edges.find((e) => e.source === branch && e.label === "True")?.target as string;
const no = cfg.edges.find((e) => e.source === branch && e.label === "False")?.target as string;

function sides(positions: Positions, overrides: EdgeOverrides = {}, graph: Cfg = cfg) {
  const routed = routeEdges(graph, nodeBoxes(graph, positions), overrides);
  const side = (label: string) => routed.find((e) => e.source === branch && e.label === label)?.sourceSide;
  return { yes: side("True"), no: side("False"), routed };
}

describe("routeEdges", () => {
  const laid = autoLayout(cfg);
  const at = (id: string) => laid[id] as { x: number; y: number };

  it("keeps True below and False to the right as laid out", () => {
    expect(sides(laid)).toMatchObject({ yes: "bottom", no: "right" });
  });

  it("takes False from the left vertex once its target is moved to the left", () => {
    const moved = { ...laid, [no]: { x: at(branch).x - 300, y: at(no).y } };
    expect(sides(moved)).toMatchObject({ yes: "bottom", no: "left" });
  });

  it("swaps the exits when the targets swap places", () => {
    const moved = { ...laid, [yes]: at(no), [no]: at(yes) };
    expect(sides(moved)).toMatchObject({ yes: "right", no: "bottom" });
  });

  it("keeps a side the user chose and moves the other exit off it", () => {
    const edge = cfg.edges.find((e) => e.source === branch && e.label === "False");
    if (!edge) throw new Error("no False edge");
    const { yes: yesSide, no: noSide, routed } = sides(laid, { [edgeKey(edge)]: { source: "bottom" } });
    expect([yesSide, noSide]).toEqual(["right", "bottom"]);
    const drawn = routed.find((e) => e.key === edgeKey(edge));
    const box = nodeBoxes(cfg, laid).get(branch);
    expect(drawn?.geometry.points[0]).toEqual({
      x: (box?.x ?? 0) + (box?.width ?? 0) / 2,
      y: (box?.y ?? 0) + (box?.height ?? 0),
    });
  });

  it("keeps a drawn route attached when its target moves", () => {
    const edge = cfg.edges.find((e) => e.source === branch && e.label === "False");
    if (!edge) throw new Error("no False edge");
    const key = edgeKey(edge);
    const boxes = nodeBoxes(cfg, laid);
    const s = boxes.get(branch) as Box;
    const t = boxes.get(no) as Box;
    // Out of the right vertex, down a lane 40px past the target's center, and into its top.
    const lane = t.x + t.width / 2 + 40;
    const s0 = { x: s.x + s.width, y: s.y + s.height / 2 };
    const points = [
      s0,
      { x: lane, y: s0.y },
      { x: lane, y: t.y - 20 },
      { x: t.x + t.width / 2, y: t.y - 20 },
      { x: t.x + t.width / 2, y: t.y },
    ];
    const overrides: EdgeOverrides = { [key]: { source: "right", target: "top", points } };
    const moved = { ...laid, [no]: { x: t.x + 12, y: t.y + 40 } };
    const after = sides(moved, overrides).routed.find((e) => e.key === key)?.geometry.points ?? [];
    expect(after.at(-1)).toEqual({ x: t.x + 12 + t.width / 2, y: t.y + 40 });
    expect(after.some((p) => p.x === lane)).toBe(true);
  });
});
