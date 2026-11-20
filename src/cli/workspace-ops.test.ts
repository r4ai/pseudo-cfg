import { describe, expect, it } from "vitest";
import { nodeBoxes, routeEdges } from "@/features/diagram/geometry";
import {
  applyBatchOps,
  createWorkspace,
  inferLanguageFromPath,
  inspectWorkspace,
  moveNodes,
  parsePointList,
  resetEdge,
  resolveEdge,
  routeEdgeSides,
  setEdgePoints,
  shiftEdgeSegment,
  tidyWorkspace,
  updateWorkspaceSource,
} from "./workspace-ops";

const SAMPLE = `def check(x):
    if x > 0:
        y = 1
    else:
        y = -1
    return y
`;

describe("workspace-ops", () => {
  it("infers language from file extensions", () => {
    expect(inferLanguageFromPath("algo.py")).toBe("python");
    expect(inferLanguageFromPath("kernel.cu")).toBe("cuda");
    expect(inferLanguageFromPath("src/main.cpp")).toBe("cuda");
    expect(inferLanguageFromPath("header.h")).toBe("cuda");
    expect(inferLanguageFromPath("notes.txt")).toBe("python");
    expect(inferLanguageFromPath(undefined)).toBe("python");
  });

  it("creates deterministic n0.. node IDs and preserves manual positions across incremental edits", () => {
    const { workspace } = createWorkspace(SAMPLE);
    expect(workspace.cfg.nodes.map((n) => n.id)).toEqual(["n0", "n2", "n3", "n4", "n5", "n1"]);

    const moved = moveNodes(workspace, ["n4"], { x: 420, y: 260 }).workspace;
    const rerouted = routeEdgeSides(moved, "n2->n4:F", { from: "left", to: "top" }).workspace;

    // Small edit: add a statement inside the True branch.
    const edited = SAMPLE.replace("y = 1", "y = 1\n        z = y + 1");
    const updated = updateWorkspaceSource(rerouted, edited);

    expect(updated.relaid).toBe(false);
    expect(updated.workspace.positions.n4).toEqual({ x: 420, y: 260 });
    expect(updated.workspace.edges["n2>n4:False"]).toEqual({ source: "left", target: "top" });
  });

  it("supports absolute, center, relative, and relational node moves", () => {
    const { workspace } = createWorkspace(SAMPLE);
    const before = inspectWorkspace(workspace);
    const n2 = before.nodes.find((n) => n.id === "n2");
    const n4 = before.nodes.find((n) => n.id === "n4");
    if (!n2 || !n4) throw new Error("missing nodes");

    // Place n4 to the left of n2 with a 48px gap.
    const leftRes = moveNodes(workspace, ["n4"], { leftOf: "n2", gap: 48 });
    const movedN4 = leftRes.moved[0];
    expect(movedN4).toBeDefined();
    expect(movedN4?.x).toBeCloseTo(n2.x - n4.width - 48, 1);
    expect(movedN4?.cy).toBeCloseTo(n2.cy, 1);

    // Center-X placement + relative shift + snap.
    const cxRes = moveNodes(leftRes.workspace, ["n4"], { cx: 100, dy: -21, snap: true });
    expect((cxRes.moved[0]?.x ?? 0) % 4).toBe(0);
    expect((cxRes.moved[0]?.y ?? 0) % 4).toBe(0);
  });

  it("resolves edges by handle, key, and shorthand selectors", () => {
    const { workspace } = createWorkspace(SAMPLE);
    const boxes = nodeBoxes(workspace.cfg, workspace.positions);
    const routed = routeEdges(workspace.cfg, boxes, workspace.edges);

    const byShorthand = resolveEdge(routed, "n2->n4:F");
    const byFullLabel = resolveEdge(routed, "n2->n4:False");
    const byPair = resolveEdge(routed, "n2->n4");
    const byHandle = resolveEdge(routed, `e${byShorthand.index}`);
    const byKey = resolveEdge(routed, byShorthand.edge.key);

    expect(byFullLabel.index).toBe(byShorthand.index);
    expect(byPair.index).toBe(byShorthand.index);
    expect(byHandle.index).toBe(byShorthand.index);
    expect(byKey.index).toBe(byShorthand.index);

    expect(() => resolveEdge(routed, "e999")).toThrow(/out of range/);
    expect(() => resolveEdge(routed, "n2->n99")).toThrow(/not found/);
  });

  it("routes edge sides, shifts segments by delta and --at, sets via waypoints, and resets", () => {
    const { workspace } = createWorkspace(SAMPLE);

    // 1. Pin sides
    const r1 = routeEdgeSides(workspace, "n2->n4:F", { from: "right", to: "right" });
    expect(r1.edge.sourceSide).toBe("right");
    expect(r1.edge.targetSide).toBe("right");
    expect(r1.edge.mode).toBe("sides");

    // 2. Shift a vertical segment directly to x = 500
    const vertSeg = r1.edge.segments.find((s) => s.orientation === "vertical");
    if (!vertSeg || vertSeg.coord === null) throw new Error("expected a vertical segment");
    const r2 = shiftEdgeSegment(r1.workspace, r1.edge.handle, vertSeg.index, { at: 500 });
    expect(r2.edge.mode).toBe("points");
    expect(r2.edge.segments.some((s) => s.orientation === "vertical" && s.coord === 500)).toBe(true);

    // 3. Shift that vertical segment by +24px
    const vSeg2 = r2.edge.segments.find((s) => s.orientation === "vertical" && s.coord === 500);
    if (!vSeg2) throw new Error("expected vertical segment at 500");
    const r3 = shiftEdgeSegment(r2.workspace, r2.edge.handle, vSeg2.index, { delta: 24 });
    expect(r3.edge.segments.some((s) => s.orientation === "vertical" && s.coord === 524)).toBe(true);

    // 4. Set explicit --via waypoints
    const info = inspectWorkspace(r3.workspace);
    const n2 = info.nodes.find((n) => n.id === "n2");
    const n4 = info.nodes.find((n) => n.id === "n4");
    if (!n2 || !n4) throw new Error("missing nodes");
    const s = n2.anchors.right;
    const t = n4.anchors.top;
    const r4 = setEdgePoints(r3.workspace, r3.edge.handle, {
      from: "right",
      to: "top",
      via: [
        { x: 460, y: s.y },
        { x: 460, y: t.y - 30 },
        { x: t.x, y: t.y - 30 },
      ],
    });
    expect(r4.edge.mode).toBe("points");
    expect(r4.edge.points[0]).toEqual(s);
    expect(r4.edge.points.at(-1)).toEqual(t);

    // Reject diagonal points with an informative message
    expect(() =>
      setEdgePoints(r4.workspace, r4.edge.handle, {
        via: [{ x: s.x + 15, y: s.y + 15 }],
      }),
    ).toThrow(/diagonal/);

    // 5. Reset single edge back to auto
    const r5 = resetEdge(r4.workspace, r4.edge.handle);
    expect(r5.resetCount).toBe(1);
    expect(r5.edge?.mode).toBe("auto");
    expect(r5.workspace.edges).toEqual({});
  });

  it("applies batch ops atomically and tidies workspace", () => {
    const { workspace } = createWorkspace(SAMPLE);
    const applied = applyBatchOps(workspace, [
      { op: "node.move", id: "n4", leftOf: "n2", gap: 48 },
      { op: "edge.route", edge: "n2->n4:F", from: "left", to: "top" },
    ]);
    expect(applied.applied).toBe(2);
    expect(applied.workspace.edges["n2>n4:False"]).toEqual({ source: "left", target: "top" });

    // Failing op throws with op index and leaves input workspace unchanged
    expect(() =>
      applyBatchOps(applied.workspace, [
        { op: "node.move", id: "n4", dx: 10 },
        { op: "node.move", id: "does-not-exist", dx: 10 },
      ]),
    ).toThrow(/Operation #1/);

    const tidied = tidyWorkspace(applied.workspace);
    expect(tidied.edges).toEqual({});
  });

  it("parses point lists from text and JSON", () => {
    expect(parsePointList("10,20 30,20 30,50")).toEqual([
      { x: 10, y: 20 },
      { x: 30, y: 20 },
      { x: 30, y: 50 },
    ]);
    expect(parsePointList("-10,20; 30.5,-40")).toEqual([
      { x: -10, y: 20 },
      { x: 30.5, y: -40 },
    ]);
    expect(parsePointList('[{"x":1,"y":2},[3,4]]')).toEqual([
      { x: 1, y: 2 },
      { x: 3, y: 4 },
    ]);
    expect(() => parsePointList("10,bad")).toThrow(/Invalid coordinates/);
  });
});
