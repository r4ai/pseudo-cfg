import type { Cfg } from "@/features/cfg/build-cfg";
import { type Box, LABEL_HEIGHT, labelWidth, type Point } from "./edge-route";
import type { RoutedEdge } from "./geometry";

export type NodeOverlap = { a: string; b: string };
export type EdgeThroughNode = { edgeIndex: number; edgeKey: string; nodeId: string };
export type CollinearEdgeOverlap = { edgeA: number; edgeB: number; overlapLength: number };
export type UnhoppedCrossing = { edgeA: number; edgeB: number; at: Point };
export type CoveredLabel = { edgeIndex: number; edgeKey: string; label: string };

export type DiagramQualityReport = {
  ok: boolean;
  issueCount: number;
  nodeOverlaps: NodeOverlap[];
  edgesThroughNodes: EdgeThroughNode[];
  collinearEdgeOverlaps: CollinearEdgeOverlap[];
  unhoppedCrossings: UnhoppedCrossing[];
  coveredLabels: CoveredLabel[];
  hoppedCrossings: number;
};

type EdgeSegment = { edgeIndex: number; target: string; a: Point; b: Point };

/**
 * Audits a laid-out and routed CFG for visual defects: overlapping nodes, edges
 * cutting through non-endpoint nodes, collinear edge overlaps, unhopped crossings,
 * and labels obscured by nodes or lines.
 */
export function checkDiagramQuality(
  cfg: Cfg,
  boxes: Map<string, Box>,
  routed: RoutedEdge[],
): DiagramQualityReport {
  const nodeOverlaps = findNodeOverlaps(cfg, boxes);
  const edgesThroughNodes = findEdgesThroughNodes(cfg, boxes, routed);
  const collinearEdgeOverlaps = findCollinearEdgeOverlaps(routed);
  const unhoppedCrossings = findUnhoppedCrossings(routed);
  const coveredLabels = findCoveredLabels(routed, boxes);
  const hoppedCrossings = routed.reduce((sum, edge) => sum + edge.geometry.hops.length, 0);
  const issueCount =
    nodeOverlaps.length +
    edgesThroughNodes.length +
    collinearEdgeOverlaps.length +
    unhoppedCrossings.length +
    coveredLabels.length;

  return {
    ok: issueCount === 0,
    issueCount,
    nodeOverlaps,
    edgesThroughNodes,
    collinearEdgeOverlaps,
    unhoppedCrossings,
    coveredLabels,
    hoppedCrossings,
  };
}

function findNodeOverlaps(cfg: Cfg, boxes: Map<string, Box>): NodeOverlap[] {
  const found: NodeOverlap[] = [];
  for (let i = 0; i < cfg.nodes.length; i++) {
    const nodeA = cfg.nodes[i];
    const boxA = nodeA ? boxes.get(nodeA.id) : undefined;
    if (!nodeA || !boxA) continue;
    for (let j = i + 1; j < cfg.nodes.length; j++) {
      const nodeB = cfg.nodes[j];
      const boxB = nodeB ? boxes.get(nodeB.id) : undefined;
      if (!nodeB || !boxB) continue;
      if (boxesOverlapStrict(boxA, boxB)) found.push({ a: nodeA.id, b: nodeB.id });
    }
  }
  return found;
}

function findEdgesThroughNodes(cfg: Cfg, boxes: Map<string, Box>, routed: RoutedEdge[]): EdgeThroughNode[] {
  const found: EdgeThroughNode[] = [];
  const seen = new Set<string>();
  for (const [edgeIndex, edge] of routed.entries()) {
    for (const [i, b] of edge.geometry.points.slice(1).entries()) {
      const a = edge.geometry.points[i] as Point;
      for (const node of cfg.nodes) {
        const box = boxes.get(node.id);
        if (!box || node.id === edge.source || node.id === edge.target) continue;
        const hit =
          Math.min(a.x, b.x) < box.x + box.width - 1 &&
          box.x + 1 < Math.max(a.x, b.x) &&
          Math.min(a.y, b.y) < box.y + box.height - 1 &&
          box.y + 1 < Math.max(a.y, b.y);
        if (hit) {
          const dedupe = `${edgeIndex}:${node.id}`;
          if (!seen.has(dedupe)) {
            seen.add(dedupe);
            found.push({ edgeIndex, edgeKey: edge.key, nodeId: node.id });
          }
        }
      }
    }
  }
  return found;
}

function findCollinearEdgeOverlaps(routed: RoutedEdge[]): CollinearEdgeOverlap[] {
  const segs: EdgeSegment[] = routed.flatMap((edge, edgeIndex) =>
    edge.geometry.points
      .slice(1)
      .map((b, i) => ({ edgeIndex, target: edge.target, a: edge.geometry.points[i] as Point, b })),
  );
  const isHorizontal = (s: EdgeSegment) => Math.abs(s.a.y - s.b.y) < 0.5;
  const isVertical = (s: EdgeSegment) => Math.abs(s.a.x - s.b.x) < 0.5;
  const span = (s: EdgeSegment, axis: "x" | "y"): [number, number] => [
    Math.min(s.a[axis], s.b[axis]),
    Math.max(s.a[axis], s.b[axis]),
  ];

  const found: CollinearEdgeOverlap[] = [];
  for (const [i, s] of segs.entries()) {
    const sH = isHorizontal(s);
    const sV = isVertical(s);
    if (!sH && !sV) continue;
    for (const u of segs.slice(i + 1)) {
      if (s.edgeIndex === u.edgeIndex || s.target === u.target) continue;
      if (sH !== isHorizontal(u) || sV !== isVertical(u)) continue;
      const [along, across] = sH ? (["x", "y"] as const) : (["y", "x"] as const);
      if (Math.abs(s.a[across] - u.a[across]) >= 3) continue;
      const [s0, s1] = span(s, along);
      const [u0, u1] = span(u, along);
      const overlapLength = Math.min(s1, u1) - Math.max(s0, u0);
      if (overlapLength > 2) {
        found.push({
          edgeA: s.edgeIndex,
          edgeB: u.edgeIndex,
          overlapLength: Math.round(overlapLength * 10) / 10,
        });
      }
    }
  }
  return found;
}

function pointSegments(points: Point[]): (readonly [Point, Point])[] {
  return points.slice(1).map((b, i) => [points[i] as Point, b] as const);
}

function findUnhoppedCrossings(routed: RoutedEdge[]): UnhoppedCrossing[] {
  const missing: UnhoppedCrossing[] = [];
  for (const [i, edge] of routed.entries()) {
    for (const [a, b] of pointSegments(edge.geometry.points)) {
      if (Math.abs(a.y - b.y) >= 0.5) continue;
      for (const [j, other] of routed.entries()) {
        if (i === j) continue;
        for (const [c, d] of pointSegments(other.geometry.points)) {
          if (Math.abs(c.x - d.x) >= 0.5) continue;
          const crosses =
            Math.min(a.x, b.x) < c.x &&
            c.x < Math.max(a.x, b.x) &&
            Math.min(c.y, d.y) < a.y &&
            a.y < Math.max(c.y, d.y);
          const hopped = edge.geometry.hops.some(
            (h) => Math.abs(h.x - c.x) < 0.5 && Math.abs(h.y - a.y) < 0.5,
          );
          if (crosses && !hopped) {
            missing.push({ edgeA: i, edgeB: j, at: { x: c.x, y: a.y } });
          }
        }
      }
    }
  }
  return missing;
}

function findCoveredLabels(routed: RoutedEdge[], boxes: Map<string, Box>): CoveredLabel[] {
  const allBoxes = [...boxes.values()];
  return routed.flatMap((edge, edgeIndex) => {
    if (!edge.label) return [];
    const width = labelWidth(edge.label);
    const { x, y } = edge.geometry.labelAt;
    const label = { x: x - width / 2, y: y - LABEL_HEIGHT / 2, width, height: LABEL_HEIGHT };
    const hits = (o: Box) =>
      label.x < o.x + o.width &&
      o.x < label.x + label.width &&
      label.y < o.y + o.height &&
      o.y < label.y + label.height;
    const onNode = allBoxes.some(hits);
    const onEdge = routed.some((other) =>
      other.geometry.points.slice(1).some((b, i) => {
        const a = other.geometry.points[i] as Point;
        const x0 = Math.min(a.x, b.x);
        const x1 = Math.max(a.x, b.x);
        const y0 = Math.min(a.y, b.y);
        const y1 = Math.max(a.y, b.y);
        return hits({ x: x0, y: y0, width: x1 - x0, height: y1 - y0 });
      }),
    );
    return onNode || onEdge ? [{ edgeIndex, edgeKey: edge.key, label: edge.label }] : [];
  });
}

function boxesOverlapStrict(a: Box, b: Box): boolean {
  return (
    a.x < b.x + b.width - 1 && b.x + 1 < a.x + a.width && a.y < b.y + b.height - 1 && b.y + 1 < a.y + a.height
  );
}
