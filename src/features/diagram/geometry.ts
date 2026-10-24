import type { Cfg, CfgEdge } from "@/features/cfg/build-cfg";
import {
  type Box,
  crossings,
  type EdgeGeometry,
  labelPosition,
  labelWidth,
  routeEdge,
  toneOf,
  verticalLanes,
} from "./edge-route";
import { components, nodeSize, type Positions } from "./layout";

export type RoutedEdge = CfgEdge & { id: string; geometry: EdgeGeometry };

/** Box of every node at its current position. */
export function nodeBoxes(cfg: Cfg, positions: Positions): Map<string, Box> {
  return new Map(
    cfg.nodes.map((node) => [node.id, { ...(positions[node.id] ?? { x: 0, y: 0 }), ...nodeSize(node) }]),
  );
}

/** Routes every edge against the current node boxes of its own scope. */
export function routeEdges(cfg: Cfg, boxes: Map<string, Box>): RoutedEdge[] {
  const kinds = new Map(cfg.nodes.map((n) => [n.id, n.kind]));
  const scopeBoxes = new Map<string, Box[]>();
  const lanesOf = new Map<string, Box[]>();
  for (const scope of components(cfg)) {
    const shared = scope.nodes.flatMap((n) => boxes.get(n.id) ?? []);
    const lanes: Box[] = [];
    for (const node of scope.nodes) {
      scopeBoxes.set(node.id, shared);
      lanesOf.set(node.id, lanes);
    }
  }
  const routed: RoutedEdge[] = cfg.edges.flatMap((edge, index) => {
    const source = boxes.get(edge.source);
    const target = boxes.get(edge.target);
    if (!source || !target) return [];
    const tone = toneOf(edge.label);
    const exit = tone === "yes" || tone === "no" ? tone : "plain";
    const flatTarget = kinds.get(edge.target) === "block";
    const obstacles = scopeBoxes.get(edge.source) ?? [];
    const lanes = lanesOf.get(edge.source) ?? [];
    const options = { exit, flatTarget, back: edge.back, outer: edge.jump, lanes } as const;
    const geometry = routeEdge(source, target, obstacles, options);
    lanes.push(...verticalLanes(geometry.points));
    if (edge.label) geometry.labelAt = labelPosition(geometry.points, labelWidth(edge.label));
    return [{ ...edge, id: `${edge.source}>${edge.target}#${index}`, geometry }];
  });
  const hops = crossings(routed.map((edge) => edge.geometry.points));
  for (const [i, edge] of routed.entries()) edge.geometry.hops = hops[i] ?? [];
  return routed;
}
