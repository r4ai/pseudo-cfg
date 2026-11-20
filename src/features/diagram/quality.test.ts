import { describe, expect, it } from "vitest";
import { buildCfg } from "@/features/cfg/build-cfg";
import { anchor } from "./edge-route";
import { edgeKey, nodeBoxes, routeEdges } from "./geometry";
import { autoLayout } from "./layout";
import { checkDiagramQuality } from "./quality";

describe("checkDiagramQuality", () => {
  it("reports zero issues for a cleanly auto-laid-out diagram", () => {
    const { cfg } = buildCfg("if x:\n    a()\nelse:\n    b()\nc()", "block");
    const positions = autoLayout(cfg);
    const boxes = nodeBoxes(cfg, positions);
    const routed = routeEdges(cfg, boxes);
    const report = checkDiagramQuality(cfg, boxes, routed);

    expect(report.ok).toBe(true);
    expect(report.issueCount).toBe(0);
    expect(report.nodeOverlaps).toEqual([]);
    expect(report.edgesThroughNodes).toEqual([]);
    expect(report.collinearEdgeOverlaps).toEqual([]);
    expect(report.unhoppedCrossings).toEqual([]);
    expect(report.coveredLabels).toEqual([]);
  });

  it("detects overlapping nodes when two nodes are placed on top of each other", () => {
    const { cfg } = buildCfg("a()\nb()", "statement");
    const positions = autoLayout(cfg);
    const [first, second] = cfg.nodes;
    if (!first || !second) throw new Error("expected nodes");
    positions[second.id] = { ...(positions[first.id] ?? { x: 0, y: 0 }) };
    const boxes = nodeBoxes(cfg, positions);
    const routed = routeEdges(cfg, boxes);
    const report = checkDiagramQuality(cfg, boxes, routed);

    expect(report.ok).toBe(false);
    expect(report.nodeOverlaps).toContainEqual({ a: first.id, b: second.id });
  });

  it("detects a manually drawn edge passing through another node", () => {
    const { cfg } = buildCfg("if x:\n    a()\nelse:\n    b()\nc()", "block");
    const positions = autoLayout(cfg);
    const boxes = nodeBoxes(cfg, positions);
    const edge = cfg.edges.find((e) => e.label === "False");
    const aNode = cfg.nodes.find((n) => n.label === "a()");
    if (!edge || !aNode) throw new Error("missing edge or node");

    const sBox = boxes.get(edge.source);
    const tBox = boxes.get(edge.target);
    const aBox = boxes.get(aNode.id);
    if (!sBox || !tBox || !aBox) throw new Error("missing box");

    const s = anchor(sBox, "bottom");
    const t = anchor(tBox, "left");
    const through = [s, { x: s.x, y: t.y }, t];
    const routed = routeEdges(cfg, boxes, {
      [edgeKey(edge)]: { source: "bottom", target: "left", points: through },
    });
    const report = checkDiagramQuality(cfg, boxes, routed);

    expect(report.ok).toBe(false);
    expect(report.edgesThroughNodes.some((hit) => hit.nodeId === aNode.id)).toBe(true);
  });
});
