import type { Cfg, CfgEdge } from "@/features/cfg/build-cfg";
import { type Box, type EdgeGeometry, routeEdge } from "./edge-route";
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
  for (const scope of components(cfg)) {
    const shared = scope.nodes.flatMap((n) => boxes.get(n.id) ?? []);
    for (const node of scope.nodes) scopeBoxes.set(node.id, shared);
  }
  return cfg.edges.flatMap((edge, index) => {
    const source = boxes.get(edge.source);
    const target = boxes.get(edge.target);
    if (!source || !target) return [];
    const fromBranch = kinds.get(edge.source) === "branch" || kinds.get(edge.source) === "loop";
    const flatTarget = kinds.get(edge.target) === "block";
    const obstacles = scopeBoxes.get(edge.source) ?? [];
    const geometry = routeEdge(source, target, fromBranch, obstacles, flatTarget);
    return [{ ...edge, id: `${edge.source}>${edge.target}#${index}`, geometry }];
  });
}
