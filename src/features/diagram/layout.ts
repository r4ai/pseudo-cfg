import { Graph, layout } from "@dagrejs/dagre";
import type { Cfg, CfgNode } from "@/features/cfg/build-cfg";

export type Point = { x: number; y: number };
export type Size = { width: number; height: number };
/** Top-left corner of each node, keyed by node id. */
export type Positions = Record<string, Point>;

const CHAR_WIDTH = 7.8;
const LINE_HEIGHT = 20;
const PAD_X = 14;
const PAD_Y = 10;
const MIN_WIDTH = 96;
const GAP = 28;

/** Size of a node as rendered; text is monospace so it can be computed up front. */
export function nodeSize(node: CfgNode): Size {
  const lines = node.label.split("\n");
  const textWidth = Math.max(...lines.map((line) => line.length)) * CHAR_WIDTH;
  const textHeight = lines.length * LINE_HEIGHT;
  switch (node.kind) {
    case "start":
    case "end":
      return { width: Math.max(MIN_WIDTH, textWidth + 40), height: 36 };
    case "block":
      return { width: Math.max(MIN_WIDTH, textWidth + 2 * PAD_X), height: textHeight + 2 * PAD_Y };
    case "branch":
      return { width: Math.max(MIN_WIDTH, 2 * textWidth + 40), height: 2 * textHeight + 24 };
    case "loop": {
      const height = textHeight + 2 * PAD_Y;
      return { width: Math.max(MIN_WIDTH, textWidth + 2 * PAD_X + height), height };
    }
  }
}

/** Lays out the whole graph from scratch. Back edges are ignored so loops read top to bottom. */
export function autoLayout(cfg: Cfg): Positions {
  const graph = new Graph();
  graph.setGraph({ rankdir: "TB", nodesep: 40, ranksep: 44, marginx: 0, marginy: 0 });
  graph.setDefaultEdgeLabel(() => ({}));
  for (const node of cfg.nodes) graph.setNode(node.id, nodeSize(node));
  for (const edge of cfg.edges) if (!edge.back) graph.setEdge(edge.source, edge.target);
  layout(graph);

  const positions: Positions = {};
  for (const node of cfg.nodes) {
    const { x = 0, y = 0, width, height } = graph.node(node.id);
    positions[node.id] = { x: x - width / 2, y: y - height / 2 };
  }
  return positions;
}

/**
 * Positions for `next` that keep every surviving node where it was.
 *
 * New nodes are placed where the fresh auto layout puts them, shifted by the same
 * offset their already-placed neighbours were moved by. Nodes below a new or grown
 * node are pushed down to make room, the way inserting a line pushes text down.
 */
export function placeIncrementally(prev: Cfg, prevPositions: Positions, next: Cfg): Positions {
  const fresh = autoLayout(next);
  const prevById = new Map(prev.nodes.map((node) => [node.id, node]));
  const kept = next.nodes.filter((node) => prevPositions[node.id] && prevById.has(node.id));
  if (kept.length === 0) return fresh;

  const offsetOf = (id: string): Point | null => {
    const old = prevPositions[id];
    const auto = fresh[id];
    return old && auto && prevById.has(id) ? { x: old.x - auto.x, y: old.y - auto.y } : null;
  };
  const globalOffset = mean(kept.map((node) => offsetOf(node.id)));

  const positions: Positions = {};
  const dirty: CfgNode[] = [];
  for (const node of next.nodes) {
    const old = prevById.get(node.id);
    const oldPosition = prevPositions[node.id];
    if (old && oldPosition) {
      positions[node.id] = oldPosition;
      if (!sameSize(nodeSize(old), nodeSize(node))) dirty.push(node);
      continue;
    }
    const preds = next.edges.filter((e) => e.target === node.id && !e.back).map((e) => offsetOf(e.source));
    const succs = next.edges.filter((e) => e.source === node.id && !e.back).map((e) => offsetOf(e.target));
    const offset = mean(preds) ?? mean(succs) ?? globalOffset ?? { x: 0, y: 0 };
    const auto = fresh[node.id] ?? { x: 0, y: 0 };
    positions[node.id] = { x: auto.x + offset.x, y: auto.y + offset.y };
    dirty.push(node);
  }

  makeRoom(next.nodes, positions, dirty);
  return positions;
}

type Rect = { id: string; x: number; y: number; width: number; height: number };

function makeRoom(nodes: CfgNode[], positions: Positions, dirty: CfgNode[]) {
  const rects = new Map<string, Rect>(
    nodes.map((node) => [
      node.id,
      { id: node.id, ...(positions[node.id] ?? { x: 0, y: 0 }), ...nodeSize(node) },
    ]),
  );
  const ordered = dirty.map((node) => rects.get(node.id) as Rect).toSorted((a, b) => a.y - b.y);

  for (const rect of ordered) {
    for (let guard = 0; guard < 100; guard++) {
      const hit = [...rects.values()].find((other) => other !== rect && overlaps(rect, other, GAP));
      if (!hit) break;
      if (hit.y + hit.height / 2 < rect.y + rect.height / 2) {
        rect.y = hit.y + hit.height + GAP;
        continue;
      }
      const dy = rect.y + rect.height + GAP - hit.y;
      for (const other of rects.values()) if (other !== rect && other.y >= hit.y) other.y += dy;
    }
  }
  for (const rect of rects.values()) positions[rect.id] = { x: rect.x, y: rect.y };
}

function overlaps(a: Rect, b: Rect, gap: number): boolean {
  return (
    a.x < b.x + b.width + gap &&
    b.x < a.x + a.width + gap &&
    a.y < b.y + b.height + gap &&
    b.y < a.y + a.height + gap
  );
}

function sameSize(a: Size, b: Size): boolean {
  return a.width === b.width && a.height === b.height;
}

function mean(points: (Point | null)[]): Point | null {
  const present = points.filter((p): p is Point => p !== null);
  if (present.length === 0) return null;
  return {
    x: present.reduce((sum, p) => sum + p.x, 0) / present.length,
    y: present.reduce((sum, p) => sum + p.y, 0) / present.length,
  };
}
