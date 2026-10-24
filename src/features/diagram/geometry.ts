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
  const scopeOf = new Map<string, string[]>();
  for (const scope of components(cfg)) {
    const ids = scope.nodes.map((n) => n.id);
    for (const id of ids) scopeOf.set(id, ids);
  }
  return cfg.edges.flatMap((edge, index) => {
    const source = boxes.get(edge.source);
    const target = boxes.get(edge.target);
    if (!source || !target) return [];
    const kind = kinds.get(edge.source);
    const obstacles = (scopeOf.get(edge.source) ?? [])
      .filter((id) => id !== edge.source && id !== edge.target)
      .flatMap((id) => boxes.get(id) ?? []);
    const targetKind = kinds.get(edge.target);
    const fromBranch = kind === "branch" || kind === "loop";
    const geometry = routeEdge(source, target, fromBranch, obstacles, targetKind === "block");
    return [{ ...edge, id: `${edge.source}>${edge.target}#${index}`, geometry }];
  });
}
