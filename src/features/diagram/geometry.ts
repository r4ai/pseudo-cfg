import type { Cfg, CfgEdge } from "@/features/cfg/build-cfg";
import {
  anchor,
  type Box,
  clearSpot,
  crossings,
  type EdgeGeometry,
  labelSpots,
  labelWidth,
  type Point,
  reanchor,
  routeBetween,
  routeEdge,
  type Side,
  toneOf,
  verticalLanes,
} from "./edge-route";
import { components, nodeSize, type Positions } from "./layout";

/** How the user has shaped an edge: sides they dragged its ends to, and a route they drew. */
export type EdgeOverride = {
  source?: Side;
  target?: Side;
  /** Whole route from source anchor to target anchor; it follows the nodes when they move. */
  points?: Point[];
};
/** Keyed by `edgeKey`. */
export type EdgeOverrides = Record<string, EdgeOverride>;

export type RoutedEdge = CfgEdge & {
  id: string;
  /** Identifies the edge across edits, for `EdgeOverrides`. */
  key: string;
  geometry: EdgeGeometry;
  sourceSide: Side;
  targetSide: Side;
};

/** Stays the same while both nodes keep their ids (see `reconcile`). */
export function edgeKey(edge: CfgEdge): string {
  return `${edge.source}>${edge.target}:${edge.label ?? ""}${edge.back ? ":back" : ""}`;
}

/** Box of every node at its current position. */
export function nodeBoxes(cfg: Cfg, positions: Positions): Map<string, Box> {
  return new Map(
    cfg.nodes.map((node) => [node.id, { ...(positions[node.id] ?? { x: 0, y: 0 }), ...nodeSize(node) }]),
  );
}

type Exit = "bottom" | "right" | "left";

const DEFAULT_EXIT = { yes: "bottom", no: "right", plain: "bottom" } as const;

/**
 * The side each edge leaves from. Branch outcomes keep to their usual sides (True from the
 * bottom, False from the right vertex), which is where the layout puts their targets; once
 * the user moves a target elsewhere, its edge leaves from the side facing it, as long as no
 * sibling already leaves there. Jumps, loop back edges and sides the user chose stay put.
 */
function exitSides(cfg: Cfg, boxes: Map<string, Box>, overrides: EdgeOverrides): Side[] {
  const sides: Side[] = [];
  const bySource = new Map<string, number[]>();
  for (const [index, edge] of cfg.edges.entries()) {
    bySource.set(edge.source, [...(bySource.get(edge.source) ?? []), index]);
  }
  for (const indices of bySource.values()) {
    const taken = new Set<Side>();
    const adaptive: { index: number; want: Exit; fallback: Exit }[] = [];
    for (const index of indices) {
      const edge = cfg.edges[index] as CfgEdge;
      // `raise` leaves like `return`, from the bottom; only branch outcomes take a side vertex.
      const tone = edge.label === "raise" ? "plain" : toneOf(edge.label);
      const fallback = DEFAULT_EXIT[tone];
      const pinned = overrides[edgeKey(edge)]?.source;
      const source = boxes.get(edge.source);
      const target = boxes.get(edge.target);
      if (pinned || tone === "plain" || edge.back || edge.jump || !source || !target) {
        sides[index] = pinned ?? fallback;
        taken.add(sides[index]);
        continue;
      }
      adaptive.push({ index, want: facing(source, target), fallback });
    }
    // An edge whose target is where it usually is keeps its side before others may claim it.
    adaptive.sort((a, b) => Number(b.want === b.fallback) - Number(a.want === a.fallback));
    for (const { index, want, fallback } of adaptive) {
      const side = [want, fallback, ...(["bottom", "right", "left"] as const)].find((s) => !taken.has(s));
      sides[index] = side ?? fallback;
      taken.add(sides[index]);
    }
  }
  return sides;
}

/** The side of `source` facing `target`: below it unless it lies further to one side than down. */
function facing(source: Box, target: Box): Exit {
  const cx = source.x + source.width / 2;
  const gapX = Math.max(target.x - cx, cx - (target.x + target.width), 0);
  const gapY = target.y - (source.y + source.height);
  if (gapX <= gapY) return "bottom";
  return target.x + target.width / 2 >= cx ? "right" : "left";
}

/** Routes every edge against the current node boxes of its own scope. */
export function routeEdges(cfg: Cfg, boxes: Map<string, Box>, overrides: EdgeOverrides = {}): RoutedEdge[] {
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
  const exits = exitSides(cfg, boxes, overrides);
  const routed: RoutedEdge[] = cfg.edges.flatMap((edge, index) => {
    const source = boxes.get(edge.source);
    const target = boxes.get(edge.target);
    if (!source || !target) return [];
    const key = edgeKey(edge);
    const override = overrides[key];
    const sourceSide = exits[index] ?? "bottom";
    const targetSide = override?.target ?? "top";
    const obstacles = scopeBoxes.get(edge.source) ?? [];
    const lanes = lanesOf.get(edge.source) ?? [];
    const drawn =
      override?.points &&
      reanchor(
        override.points,
        anchor(source, sourceSide),
        sourceSide,
        anchor(target, targetSide),
        targetSide,
      );
    let geometry: EdgeGeometry;
    if (drawn) geometry = { points: drawn, labelAt: drawn[0] as Point, hops: [] };
    else if (override?.source || override?.target) {
      geometry = routeBetween(source, sourceSide, target, targetSide, obstacles);
    } else {
      const exit = sourceSide === "top" ? "bottom" : sourceSide;
      const flatTarget = kinds.get(edge.target) === "block";
      geometry = routeEdge(source, target, obstacles, {
        exit,
        flatTarget,
        back: edge.back,
        outer: edge.jump,
        lanes,
      });
    }
    lanes.push(...verticalLanes(geometry.points));
    return [{ ...edge, id: `${edge.source}>${edge.target}#${index}`, key, geometry, sourceSide, targetSide }];
  });
  const routes = routed.map((edge) => edge.geometry.points);
  const hops = crossings(routes);
  const allBoxes = [...boxes.values()];
  for (const [i, edge] of routed.entries()) {
    edge.geometry.hops = hops[i] ?? [];
    if (!edge.label) continue;
    // Labels go where they cover no line and no node, so they stay legible after any rearrangement.
    const width = labelWidth(edge.label);
    edge.geometry.labelAt = clearSpot(labelSpots(edge.geometry.points, width), width, allBoxes, routes);
  }
  return routed;
}
