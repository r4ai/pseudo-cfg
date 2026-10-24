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
const BRANCH_PAD_Y = 22;

/** Wide (CJK, full-width) characters take two monospace columns. */
const WIDE =
  /[\u1100-\u115f\u2e80-\u303e\u3041-\u33ff\u3400-\u4dbf\u4e00-\u9fff\ua960-\ua97f\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6\u{1f300}-\u{1faff}\u{20000}-\u{3fffd}]/u;

/** Display width of a line in monospace columns. */
export function columns(line: string): number {
  let width = 0;
  for (const ch of line) width += WIDE.test(ch) ? 2 : 1;
  return width;
}

/** Lines longer than this many columns wrap, so one long statement can't stretch the graph. */
const MAX_COLUMNS = 56;

/**
 * The label as drawn: its own lines, with long ones wrapped at spaces where possible.
 * Layout, the canvas and image export all use this so sizes and text agree.
 */
export function displayLines(label: string): string[] {
  return label.split("\n").flatMap((line) => wrap(line));
}

function wrap(line: string): string[] {
  const lines: string[] = [];
  let rest = line;
  while (columns(rest) > MAX_COLUMNS) {
    let cut = 0;
    let width = 0;
    for (const ch of rest) {
      const w = columns(ch);
      if (width + w > MAX_COLUMNS) break;
      width += w;
      cut += ch.length;
    }
    const space = rest.lastIndexOf(" ", cut);
    const at = space > cut / 2 ? space + 1 : cut;
    lines.push(rest.slice(0, at).trimEnd());
    rest = rest.slice(at);
  }
  lines.push(rest);
  return lines;
}

/** Size of a node as rendered; text is monospace so it can be computed up front. */
export function nodeSize(node: CfgNode): Size {
  const lines = displayLines(node.label);
  const textWidth = Math.max(...lines.map(columns)) * CHAR_WIDTH;
  const textHeight = lines.length * LINE_HEIGHT;
  switch (node.kind) {
    case "start":
    case "end":
      return { width: Math.max(MIN_WIDTH, textWidth + 40), height: Math.max(36, textHeight + 16) };
    case "block":
      return { width: Math.max(MIN_WIDTH, textWidth + 2 * PAD_X), height: textHeight + 2 * PAD_Y };
    case "branch": {
      // A multi-line condition would make a very wide diamond; it is drawn as a hexagon instead.
      if (lines.length > 1) {
        const height = textHeight + 2 * PAD_Y;
        return { width: Math.max(MIN_WIDTH, textWidth + 2 * PAD_X + height), height };
      }
      // A diamond whose inscribed rectangle holds the text: w/W + h/H <= 1 for half-sizes.
      const height = textHeight + 2 * BRANCH_PAD_Y;
      const width = (textWidth + 2 * PAD_X) / (1 - textHeight / height);
      return { width: Math.max(MIN_WIDTH, Math.ceil(width)), height };
    }
    case "loop": {
      const height = textHeight + 2 * PAD_Y;
      return { width: Math.max(MIN_WIDTH, textWidth + 2 * PAD_X + height), height };
    }
  }
}

/**
 * Lays out the whole graph from scratch. Back edges are ignored so loops read top to bottom.
 *
 * Each scope (top-level code and every `def`) is a separate connected graph; they are laid
 * out on their own and placed side by side in source order, wrapping into rows.
 */
export function autoLayout(cfg: Cfg): Positions {
  const positions: Positions = {};
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  for (const component of components(cfg)) {
    const { positions: local, width, height } = layoutComponent(component);
    if (x > 0 && x + width > ROW_WIDTH) {
      x = 0;
      y += rowHeight + SCOPE_GAP;
      rowHeight = 0;
    }
    for (const [id, p] of Object.entries(local)) positions[id] = { x: p.x + x, y: p.y + y };
    x += width + SCOPE_GAP;
    rowHeight = Math.max(rowHeight, height);
  }
  return positions;
}

const SCOPE_GAP = 96;
const ROW_WIDTH = 1600;

function layoutComponent(cfg: Cfg): { positions: Positions; width: number; height: number } {
  const graph = new Graph();
  graph.setGraph({ rankdir: "TB", nodesep: 40, ranksep: 44, marginx: 0, marginy: 0 });
  graph.setDefaultEdgeLabel(() => ({}));
  for (const node of cfg.nodes) graph.setNode(node.id, nodeSize(node));
  for (const edge of cfg.edges) if (!edge.back) graph.setEdge(edge.source, edge.target);
  layout(graph);

  const positions: Positions = {};
  let width = 0;
  let height = 0;
  for (const node of cfg.nodes) {
    const { x = 0, y = 0, width: w, height: h } = graph.node(node.id);
    positions[node.id] = { x: x - w / 2, y: y - h / 2 };
    width = Math.max(width, x + w / 2);
    height = Math.max(height, y + h / 2);
  }
  return { positions, width, height };
}

/** Connected subgraphs (one per scope) in the order their first node appears. */
export function components(cfg: Cfg): Cfg[] {
  const root = new Map(cfg.nodes.map((node) => [node.id, node.id]));
  const find = (id: string): string => {
    const parent = root.get(id) ?? id;
    if (parent === id) return id;
    const top = find(parent);
    root.set(id, top);
    return top;
  };
  for (const edge of cfg.edges) root.set(find(edge.source), find(edge.target));

  const groups = new Map<string, Cfg>();
  for (const node of cfg.nodes) {
    const key = find(node.id);
    const group = groups.get(key) ?? { nodes: [], edges: [] };
    group.nodes.push(node);
    groups.set(key, group);
  }
  for (const edge of cfg.edges) groups.get(find(edge.source))?.edges.push(edge);
  return [...groups.values()];
}

/**
 * Positions for `next` that keep every surviving node where it was.
 *
 * New nodes are placed where the fresh auto layout puts them, shifted by the same
 * offset their already-placed neighbours were moved by. Nodes below a new or grown
 * node are pushed down to make room, the way inserting a line pushes text down.
 */
export function placeIncrementally(prev: Cfg, prevPositions: Positions, next: Cfg): Positions {
  if (mostlyReplaced(prev, prevPositions, next)) return autoLayout(next);
  const prevById = new Map(prev.nodes.map((node) => [node.id, node]));
  // Auto layout positions are only used to place new nodes relative to their scope, so only
  // scopes that gained a node are laid out; edits within a statement lay out nothing.
  const isNew = (node: CfgNode) => !prevById.has(node.id) || !prevPositions[node.id];
  const kept = next.nodes.filter((node) => !isNew(node));
  const fresh: Positions = {};
  // A wholly new scope goes to the right of everything already placed, not on top of it.
  const scopeOffsets = new Map<string, Point>();
  // Reduced rather than spread, which overflows the stack on very large graphs.
  let right = kept.reduce(
    (max, n) => Math.max(max, (prevPositions[n.id]?.x ?? 0) + nodeSize(n).width),
    -Infinity,
  );
  const top = kept.reduce((min, n) => Math.min(min, prevPositions[n.id]?.y ?? 0), Infinity);
  for (const scope of components(next)) {
    if (!scope.nodes.some(isNew)) continue;
    const local = layoutComponent(scope);
    Object.assign(fresh, local.positions);
    if (scope.nodes.some((node) => !isNew(node))) continue;
    for (const node of scope.nodes) scopeOffsets.set(node.id, { x: right + SCOPE_GAP, y: top });
    right += SCOPE_GAP + local.width;
  }

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
    const offset = scopeOffsets.get(node.id) ?? mean(preds) ?? mean(succs) ?? globalOffset ?? { x: 0, y: 0 };
    const auto = fresh[node.id] ?? { x: 0, y: 0 };
    positions[node.id] = { x: auto.x + offset.x, y: auto.y + offset.y };
    dirty.push(node);
  }

  makeRoom(next, positions, dirty, (node) => !prevById.has(node.id));
  return positions;
}

const isContent = (node: CfgNode) => node.kind !== "start" && node.kind !== "end";

/**
 * Whether too little of the graph survived for the old arrangement to be worth keeping,
 * as after replacing the whole text. Start and end nodes always survive, so they don't count.
 * A node that kept its id but changed its text (see `reconcile`) is weaker evidence of an
 * in-place edit than an unchanged one, so it counts half.
 */
export function mostlyReplaced(prev: Cfg, prevPositions: Positions, next: Cfg): boolean {
  const prevLabels = new Map(prev.nodes.map((node) => [node.id, node.label]));
  const kept = (node: CfgNode) => prevLabels.has(node.id) && prevPositions[node.id] !== undefined;
  if (!next.nodes.some(isContent)) return true;
  // A wholly new scope is placed beside the others, so it says nothing about the rest.
  const content = components(next)
    .filter((scope) => scope.nodes.some(kept))
    .flatMap((scope) => scope.nodes.filter(isContent));
  if (content.length === 0) return !next.nodes.some(kept);
  let score = 0;
  for (const node of content) {
    if (kept(node)) score += prevLabels.get(node.id) === node.label ? 2 : 1;
  }
  return score < content.length;
}

type Rect = { id: string; x: number; y: number; width: number; height: number };

/**
 * Resolves overlaps caused by new or grown nodes, and keeps a new node above the nodes it
 * flows into, pushing whatever lies below down as inserting a line pushes text down.
 */
function makeRoom(cfg: Cfg, positions: Positions, dirty: CfgNode[], isAdded: (node: CfgNode) => boolean) {
  const rects = new Map<string, Rect>(
    cfg.nodes.map((node) => [
      node.id,
      { id: node.id, ...(positions[node.id] ?? { x: 0, y: 0 }), ...nodeSize(node) },
    ]),
  );
  const ordered = dirty.map((node) => rects.get(node.id) as Rect).toSorted((a, b) => a.y - b.y);
  // Only added nodes push what they flow into; a node that merely grew keeps its neighbours put.
  const added = new Set(dirty.filter(isAdded).map((node) => node.id));
  const pushDown = (from: Rect, by: number, except: Rect) => {
    for (const other of rects.values()) if (other !== except && other.y >= from.y) other.y += by;
  };

  for (const rect of ordered) {
    for (let guard = 0; guard < 100; guard++) {
      const hit = [...rects.values()].find((other) => other !== rect && overlaps(rect, other, GAP));
      if (!hit) break;
      if (hit.y + hit.height / 2 < rect.y + rect.height / 2) {
        rect.y = hit.y + hit.height + GAP;
        continue;
      }
      pushDown(hit, rect.y + rect.height + GAP - hit.y, rect);
    }
    if (!added.has(rect.id)) continue;
    for (const edge of cfg.edges) {
      const next = edge.source === rect.id && !edge.back ? rects.get(edge.target) : undefined;
      if (!next || next.y >= rect.y + rect.height + GAP) continue;
      // Only what the new node flows into moves; parallel branches stay where they are.
      const dy = rect.y + rect.height + GAP - next.y;
      for (const id of descendants(cfg, next.id)) {
        const r = rects.get(id);
        if (r && r !== rect) r.y += dy;
      }
    }
  }
  for (const rect of rects.values()) positions[rect.id] = { x: rect.x, y: rect.y };
}

/** `id` and every node reachable from it along forward edges. */
function descendants(cfg: Cfg, id: string): Set<string> {
  const seen = new Set([id]);
  for (const current of seen) {
    for (const edge of cfg.edges) if (edge.source === current && !edge.back) seen.add(edge.target);
  }
  return seen;
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
