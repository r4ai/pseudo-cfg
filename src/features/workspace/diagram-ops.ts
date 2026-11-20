import { buildCfg, type CfgNode, type Granularity, type Language } from "@/features/cfg/build-cfg";
import type { Diagnostic } from "@/features/cfg/parse";
import { reconcile } from "@/features/cfg/reconcile";
import {
  anchor,
  type Box,
  dragSegment,
  type Point,
  reanchor,
  shortLabel,
  type Side,
  simplify,
} from "@/features/diagram/edge-route";
import {
  type EdgeOverride,
  type EdgeOverrides,
  edgeKey,
  nodeBoxes,
  type RoutedEdge,
  routeEdges,
} from "@/features/diagram/geometry";
import {
  autoLayout,
  mostlyReplaced,
  nodeSize,
  placeIncrementally,
  type Positions,
} from "@/features/diagram/layout";
import { checkDiagramQuality, type DiagramQualityReport } from "@/features/diagram/quality";
import type { SavedWorkspace } from "./workspace-state";

export type CliWorkspace = {
  source: string;
  language: Language;
  granularity: Granularity;
  cfg: SavedWorkspace["cfg"];
  positions: Positions;
  edges: EdgeOverrides;
};

export type SegmentInfo = {
  index: number;
  orientation: "horizontal" | "vertical" | "diagonal";
  /** Which coordinate changes when sliding this segment sideways. */
  shiftAxis: "x" | "y" | null;
  /** Current fixed coordinate of the segment (x for vertical, y for horizontal). */
  coord: number | null;
  from: Point;
  to: Point;
  length: number;
};

export type NodeInspection = {
  id: string;
  kind: CfgNode["kind"];
  label: string;
  line: number;
  endLine: number;
  x: number;
  y: number;
  width: number;
  height: number;
  cx: number;
  cy: number;
  anchors: Record<Side, Point>;
};

export type EdgeInspection = {
  index: number;
  handle: string;
  key: string;
  source: string;
  target: string;
  label: string | null;
  shortLabel: string | null;
  back: boolean;
  jump: boolean;
  sourceSide: Side;
  targetSide: Side;
  mode: "auto" | "sides" | "points";
  points: Point[];
  segments: SegmentInfo[];
  labelAt: Point;
  hops: Point[];
};

export type WorkspaceInspection = {
  language: Language;
  granularity: Granularity;
  diagnostics: Diagnostic[];
  nodes: NodeInspection[];
  edges: EdgeInspection[];
  quality: DiagramQualityReport;
  bounds: { minX: number; minY: number; maxX: number; maxY: number; width: number; height: number };
};

export type MoveNodeOptions = {
  x?: number;
  y?: number;
  cx?: number;
  cy?: number;
  dx?: number;
  dy?: number;
  below?: string;
  above?: string;
  leftOf?: string;
  rightOf?: string;
  alignX?: string;
  alignY?: string;
  gap?: number;
  snap?: boolean;
};

export type BatchOp =
  | { op: "source"; code: string }
  | { op: "granularity"; value: Granularity }
  | { op: "language"; value: Language; code?: string }
  | { op: "tidy" }
  | ({ op: "node.move"; id: string | string[] } & MoveNodeOptions)
  | { op: "edge.route"; edge: string; from?: Side; to?: Side }
  | { op: "edge.shift"; edge: string; segment: number; delta?: number; at?: number; snap?: boolean }
  | { op: "edge.points"; edge: string; points?: Point[]; via?: Point[]; from?: Side; to?: Side }
  | { op: "edge.reset"; edge?: string; all?: boolean };

const VALID_SIDES: ReadonlySet<string> = new Set<Side>(["top", "right", "bottom", "left"]);
const VALID_GRANULARITIES: ReadonlySet<unknown> = new Set<Granularity>(["block", "statement"]);
const VALID_LANGUAGES: ReadonlySet<unknown> = new Set<Language>(["python", "cuda"]);
const DEFAULT_GAP = 40;
const SNAP_GRID = 4;

export function isSavedWorkspace(value: unknown): value is SavedWorkspace {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  const cfg = record.cfg;
  if (typeof cfg !== "object" || cfg === null) return false;
  const cfgRecord = cfg as Record<string, unknown>;
  return (
    typeof record.source === "string" &&
    VALID_GRANULARITIES.has(record.granularity) &&
    typeof record.positions === "object" &&
    record.positions !== null &&
    (record.language === undefined || VALID_LANGUAGES.has(record.language)) &&
    (record.edges === undefined || (typeof record.edges === "object" && record.edges !== null)) &&
    Array.isArray(cfgRecord.nodes) &&
    Array.isArray(cfgRecord.edges)
  );
}

/** Infers language from file extension when `--lang` is omitted. */
export function inferLanguageFromPath(filePath: string | undefined): Language {
  if (!filePath) return "python";
  const lower = filePath.toLowerCase();
  if (/\.(cu|cuh|c|h|cc|cpp|cxx|hpp|hxx)$/.test(lower)) return "cuda";
  return "python";
}

export function parseLanguage(raw: string): Language {
  if (raw === "python" || raw === "cuda") return raw;
  throw new Error(`Invalid language '${raw}'. Expected 'python' or 'cuda'.`);
}

export function parseGranularity(raw: string): Granularity {
  if (raw === "block" || raw === "statement") return raw;
  throw new Error(`Invalid granularity '${raw}'. Expected 'block' or 'statement'.`);
}

export function parseSide(raw: string): Side {
  if (VALID_SIDES.has(raw)) return raw as Side;
  throw new Error(`Invalid side '${raw}'. Expected one of: top, right, bottom, left.`);
}

/** Deterministic sequential IDs (`n0`, `n1`, ...) so workspaces stay readable and diff-friendly. */
export function createSequentialIdGenerator(existingIds: Iterable<string>): () => string {
  let max = -1;
  for (const id of existingIds) {
    const match = /^n(\d+)$/.exec(id);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return () => `n${++max}`;
}

export function normalizeWorkspace(saved: SavedWorkspace): CliWorkspace {
  return {
    source: saved.source,
    language: saved.language ?? "python",
    granularity: saved.granularity,
    cfg: saved.cfg,
    positions: saved.positions,
    edges: saved.edges ?? {},
  };
}

/** Creates a new workspace from source code using deterministic node IDs and structured auto-layout. */
export function createWorkspace(
  source: string,
  options: { language?: Language; granularity?: Granularity } = {},
): { workspace: CliWorkspace; diagnostics: Diagnostic[] } {
  const language = options.language ?? "python";
  const granularity = options.granularity ?? "block";
  const built = buildCfg(source, granularity, language);
  const positions = autoLayout(built.cfg);
  return {
    workspace: {
      source,
      language,
      granularity,
      cfg: built.cfg,
      positions,
      edges: {},
    },
    diagnostics: built.diagnostics,
  };
}

/** Updates source code incrementally, preserving surviving node IDs, manual positions, and edge overrides. */
export function updateWorkspaceSource(
  workspace: CliWorkspace,
  nextSource: string,
): { workspace: CliWorkspace; diagnostics: Diagnostic[]; relaid: boolean } {
  const built = buildCfg(nextSource, workspace.granularity, workspace.language);
  const nextId = createSequentialIdGenerator(workspace.cfg.nodes.map((n) => n.id));
  const cfg = reconcile(workspace.cfg, built.cfg, nextId);
  const survivingEdges = keepValidEdges(workspace.edges, cfg);

  if (mostlyReplaced(workspace.cfg, workspace.positions, cfg)) {
    return {
      workspace: {
        ...workspace,
        source: nextSource,
        cfg,
        positions: autoLayout(cfg),
        edges: {},
      },
      diagnostics: built.diagnostics,
      relaid: true,
    };
  }

  return {
    workspace: {
      ...workspace,
      source: nextSource,
      cfg,
      positions: placeIncrementally(workspace.cfg, workspace.positions, cfg),
      edges: survivingEdges,
    },
    diagnostics: built.diagnostics,
    relaid: false,
  };
}

export function setWorkspaceGranularity(
  workspace: CliWorkspace,
  granularity: Granularity,
): { workspace: CliWorkspace; diagnostics: Diagnostic[] } {
  const built = buildCfg(workspace.source, granularity, workspace.language);
  const nextId = createSequentialIdGenerator(workspace.cfg.nodes.map((n) => n.id));
  const cfg = reconcile(workspace.cfg, built.cfg, nextId);
  return {
    workspace: {
      ...workspace,
      granularity,
      cfg,
      positions: autoLayout(cfg),
      edges: {},
    },
    diagnostics: built.diagnostics,
  };
}

export function setWorkspaceLanguage(
  workspace: CliWorkspace,
  language: Language,
  nextSource = workspace.source,
): { workspace: CliWorkspace; diagnostics: Diagnostic[]; relaid: boolean } {
  return updateWorkspaceSource({ ...workspace, language }, nextSource);
}

/** Discards all manual positions and edge overrides and runs a fresh structured auto-layout. */
export function tidyWorkspace(workspace: CliWorkspace): CliWorkspace {
  return {
    ...workspace,
    positions: autoLayout(workspace.cfg),
    edges: {},
  };
}

export function inspectWorkspace(workspace: CliWorkspace): WorkspaceInspection {
  const built = buildCfg(workspace.source, workspace.granularity, workspace.language);
  const boxes = nodeBoxes(workspace.cfg, workspace.positions);
  const routed = routeEdges(workspace.cfg, boxes, workspace.edges);
  const quality = checkDiagramQuality(workspace.cfg, boxes, routed);

  const nodes: NodeInspection[] = workspace.cfg.nodes.map((node) => {
    const box = boxes.get(node.id) ?? { x: 0, y: 0, ...nodeSize(node) };
    return {
      id: node.id,
      kind: node.kind,
      label: node.label,
      line: node.line,
      endLine: node.endLine,
      x: round2(box.x),
      y: round2(box.y),
      width: round2(box.width),
      height: round2(box.height),
      cx: round2(box.x + box.width / 2),
      cy: round2(box.y + box.height / 2),
      anchors: {
        top: roundPoint(anchor(box, "top")),
        right: roundPoint(anchor(box, "right")),
        bottom: roundPoint(anchor(box, "bottom")),
        left: roundPoint(anchor(box, "left")),
      },
    };
  });

  const edges: EdgeInspection[] = routed.map((edge, index) =>
    inspectRoutedEdge(edge, index, workspace.edges),
  );
  const bounds = computeBounds(boxes, routed);

  return {
    language: workspace.language,
    granularity: workspace.granularity,
    diagnostics: built.diagnostics,
    nodes,
    edges,
    quality,
    bounds,
  };
}

export function inspectRoutedEdge(edge: RoutedEdge, index: number, overrides: EdgeOverrides): EdgeInspection {
  const override = overrides[edge.key];
  const mode = override?.points ? "points" : override?.source || override?.target ? "sides" : "auto";
  return {
    index,
    handle: `e${index}`,
    key: edge.key,
    source: edge.source,
    target: edge.target,
    label: edge.label,
    shortLabel: edge.label ? shortLabel(edge.label) : null,
    back: edge.back,
    jump: edge.jump,
    sourceSide: edge.sourceSide,
    targetSide: edge.targetSide,
    mode,
    points: edge.geometry.points.map(roundPoint),
    segments: edgeSegments(edge.geometry.points),
    labelAt: roundPoint(edge.geometry.labelAt),
    hops: edge.geometry.hops.map(roundPoint),
  };
}

export function edgeSegments(points: Point[]): SegmentInfo[] {
  const result: SegmentInfo[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const from = points[i] as Point;
    const to = points[i + 1] as Point;
    const dx = Math.abs(to.x - from.x);
    const dy = Math.abs(to.y - from.y);
    const vertical = dx < 0.5 && dy >= 0.5;
    const horizontal = dy < 0.5 && dx >= 0.5;
    const orientation = vertical ? "vertical" : horizontal ? "horizontal" : "diagonal";
    result.push({
      index: i,
      orientation,
      shiftAxis: vertical ? "x" : horizontal ? "y" : null,
      coord: vertical ? round2(from.x) : horizontal ? round2(from.y) : null,
      from: roundPoint(from),
      to: roundPoint(to),
      length: round2(Math.hypot(to.x - from.x, to.y - from.y)),
    });
  }
  return result;
}

/**
 * Resolves an edge selector in any intuitive format:
 * - `e0`, `e1`, ... or `0`, `1`, ... (0-based edge index)
 * - Exact edge key (`n3>n5:False`, `n6>n2::back`)
 * - Arrow shorthand (`n3->n5`, `n3->n5:F`, `n3->n5:False`, `n6->n2:back`, or with `>`)
 */
export function resolveEdge(routed: RoutedEdge[], selector: string): { edge: RoutedEdge; index: number } {
  const trimmed = selector.trim();

  const indexMatch = /^e?(\d+)$/i.exec(trimmed);
  if (indexMatch) {
    const index = Number(indexMatch[1]);
    const edge = routed[index];
    if (!edge) {
      throw new Error(
        `Edge '${selector}' is out of range (valid: ${routed.length > 0 ? `e0..e${routed.length - 1}` : "none"}).`,
      );
    }
    return { edge, index };
  }

  const exactIndex = routed.findIndex((e) => e.key === trimmed);
  if (exactIndex >= 0) {
    return { edge: routed[exactIndex] as RoutedEdge, index: exactIndex };
  }

  const pairMatch = /^([^>:-\s]+)\s*(?:->|>)\s*([^>:\s]+)(?::(.*))?$/.exec(trimmed);
  if (pairMatch) {
    const src = pairMatch[1] as string;
    const tgt = pairMatch[2] as string;
    const qual = pairMatch[3];
    const candidates = routed
      .map((edge, index) => ({ edge, index }))
      .filter(({ edge }) => edge.source === src && edge.target === tgt);

    const matched = qual === undefined ? candidates : filterByQualifier(candidates, qual);
    if (matched.length === 1) return matched[0] as { edge: RoutedEdge; index: number };
    if (matched.length > 1) {
      const list = matched.map(({ edge, index }) => `e${index} (${edge.key})`).join(", ");
      throw new Error(`Ambiguous edge selector '${selector}'. Matches: ${list}`);
    }
    if (candidates.length > 0) {
      const list = candidates.map(({ edge, index }) => `e${index} (${edge.key})`).join(", ");
      throw new Error(`No edge matched '${selector}'. Edges between ${src} and ${tgt}: ${list}`);
    }
    const outgoing = routed.map((edge, index) => ({ edge, index })).filter(({ edge }) => edge.source === src);
    const hint =
      outgoing.length > 0
        ? ` Outgoing edges from ${src}: ${outgoing.map(({ edge, index }) => `e${index} (${edge.source}->${edge.target}${edge.label ? `:${shortLabel(edge.label)}` : ""})`).join(", ")}`
        : "";
    throw new Error(`Edge '${selector}' not found.${hint}`);
  }

  throw new Error(
    `Edge '${selector}' not found. Use an index (e0), shorthand (n1->n2 or n1->n2:F), or exact key (n1>n2:False).`,
  );
}

function filterByQualifier(
  candidates: { edge: RoutedEdge; index: number }[],
  qual: string,
): { edge: RoutedEdge; index: number }[] {
  if (qual === "back") return candidates.filter(({ edge }) => edge.back);
  const wantsBack = qual.endsWith(":back");
  const labelPart = wantsBack ? qual.slice(0, -":back".length) : qual;
  const exact = candidates.filter(({ edge }) => {
    if (wantsBack && !edge.back) return false;
    if (labelPart === "") return edge.label === null;
    return edge.label === labelPart || (edge.label !== null && shortLabel(edge.label) === labelPart);
  });
  if (exact.length > 0) return exact;
  const lower = labelPart.toLowerCase();
  return candidates.filter(({ edge }) => {
    if (wantsBack && !edge.back) return false;
    if (edge.label === null) return false;
    return edge.label.toLowerCase() === lower || shortLabel(edge.label).toLowerCase() === lower;
  });
}

export function resolveNode(workspace: CliWorkspace, id: string): CfgNode {
  const node = workspace.cfg.nodes.find((n) => n.id === id);
  if (!node) {
    const ids = workspace.cfg.nodes.map((n) => n.id).join(", ");
    throw new Error(`Node '${id}' not found. Available nodes: ${ids || "(none)"}`);
  }
  return node;
}

/** Moves one or more nodes using absolute, center, relative, or node-relational coordinates. */
export function moveNodes(
  workspace: CliWorkspace,
  ids: string[],
  options: MoveNodeOptions,
): { workspace: CliWorkspace; moved: NodeInspection[] } {
  if (ids.length === 0) throw new Error("Specify at least one node ID to move.");
  const hasAnyMove =
    options.x !== undefined ||
    options.y !== undefined ||
    options.cx !== undefined ||
    options.cy !== undefined ||
    options.dx !== undefined ||
    options.dy !== undefined ||
    options.below !== undefined ||
    options.above !== undefined ||
    options.leftOf !== undefined ||
    options.rightOf !== undefined ||
    options.alignX !== undefined ||
    options.alignY !== undefined;
  if (!hasAnyMove) {
    throw new Error(
      "Specify at least one placement option (--x, --y, --cx, --cy, --dx, --dy, --below, --above, --left-of, --right-of, --align-x, --align-y).",
    );
  }

  const nodes = ids.map((id) => resolveNode(workspace, id));
  const boxes = nodeBoxes(workspace.cfg, workspace.positions);
  const gap = options.gap ?? DEFAULT_GAP;

  const refBox = (refId: string): Box => {
    resolveNode(workspace, refId);
    const box = boxes.get(refId);
    if (!box) throw new Error(`Reference node '${refId}' has no position.`);
    return box;
  };

  const nextPositions: Positions = { ...workspace.positions };

  for (const node of nodes) {
    const current = boxes.get(node.id) ?? { x: 0, y: 0, ...nodeSize(node) };
    let x = current.x;
    let y = current.y;

    if (options.below !== undefined) {
      const ref = refBox(options.below);
      y = ref.y + ref.height + gap;
      x = ref.x + (ref.width - current.width) / 2;
    }
    if (options.above !== undefined) {
      const ref = refBox(options.above);
      y = ref.y - current.height - gap;
      x = ref.x + (ref.width - current.width) / 2;
    }
    if (options.rightOf !== undefined) {
      const ref = refBox(options.rightOf);
      x = ref.x + ref.width + gap;
      y = ref.y + (ref.height - current.height) / 2;
    }
    if (options.leftOf !== undefined) {
      const ref = refBox(options.leftOf);
      x = ref.x - current.width - gap;
      y = ref.y + (ref.height - current.height) / 2;
    }
    if (options.alignX !== undefined) {
      const ref = refBox(options.alignX);
      x = ref.x + (ref.width - current.width) / 2;
    }
    if (options.alignY !== undefined) {
      const ref = refBox(options.alignY);
      y = ref.y + (ref.height - current.height) / 2;
    }

    if (options.x !== undefined) x = options.x;
    if (options.y !== undefined) y = options.y;
    if (options.cx !== undefined) x = options.cx - current.width / 2;
    if (options.cy !== undefined) y = options.cy - current.height / 2;
    if (options.dx !== undefined) x += options.dx;
    if (options.dy !== undefined) y += options.dy;

    if (options.snap) {
      x = snapToGrid(x);
      y = snapToGrid(y);
    }

    nextPositions[node.id] = { x: round2(x), y: round2(y) };
  }

  const nextWorkspace: CliWorkspace = { ...workspace, positions: nextPositions };
  const updatedBoxes = nodeBoxes(nextWorkspace.cfg, nextWorkspace.positions);
  const moved: NodeInspection[] = nodes.map((node) => {
    const box = updatedBoxes.get(node.id) as Box;
    return {
      id: node.id,
      kind: node.kind,
      label: node.label,
      line: node.line,
      endLine: node.endLine,
      x: round2(box.x),
      y: round2(box.y),
      width: round2(box.width),
      height: round2(box.height),
      cx: round2(box.x + box.width / 2),
      cy: round2(box.y + box.height / 2),
      anchors: {
        top: roundPoint(anchor(box, "top")),
        right: roundPoint(anchor(box, "right")),
        bottom: roundPoint(anchor(box, "bottom")),
        left: roundPoint(anchor(box, "left")),
      },
    };
  });

  return { workspace: nextWorkspace, moved };
}

/** Pins the source and/or target side of an edge (matching dragging an end handle in the UI). */
export function routeEdgeSides(
  workspace: CliWorkspace,
  selector: string,
  options: { from?: Side; to?: Side },
): { workspace: CliWorkspace; edge: EdgeInspection } {
  if (!options.from && !options.to) {
    throw new Error("Specify --from <side> and/or --to <side> (top, right, bottom, left).");
  }
  const boxes = nodeBoxes(workspace.cfg, workspace.positions);
  const routed = routeEdges(workspace.cfg, boxes, workspace.edges);
  const { edge, index } = resolveEdge(routed, selector);

  const existing = workspace.edges[edge.key] ?? {};
  const nextOverride: EdgeOverride = {};
  const nextSource = options.from ?? existing.source;
  const nextTarget = options.to ?? existing.target;
  if (nextSource) nextOverride.source = nextSource;
  if (nextTarget) nextOverride.target = nextTarget;

  const nextWorkspace: CliWorkspace = {
    ...workspace,
    edges: { ...workspace.edges, [edge.key]: nextOverride },
  };
  const updatedRouted = routeEdges(nextWorkspace.cfg, boxes, nextWorkspace.edges);
  const updated = updatedRouted[index] as RoutedEdge;
  return {
    workspace: nextWorkspace,
    edge: inspectRoutedEdge(updated, index, nextWorkspace.edges),
  };
}

/**
 * Slides one segment of an edge sideways by `delta` or directly to coordinate `at`
 * (matching dragging a segment handle in the UI).
 */
export function shiftEdgeSegment(
  workspace: CliWorkspace,
  selector: string,
  segIndex: number,
  options: { delta?: number; at?: number; snap?: boolean },
): { workspace: CliWorkspace; edge: EdgeInspection } {
  if (options.delta === undefined && options.at === undefined) {
    throw new Error("Specify either a relative <delta> or --at <coordinate>.");
  }
  if (options.delta !== undefined && options.at !== undefined) {
    throw new Error("Specify either <delta> or --at <coordinate>, not both.");
  }

  const boxes = nodeBoxes(workspace.cfg, workspace.positions);
  const routed = routeEdges(workspace.cfg, boxes, workspace.edges);
  const { edge, index } = resolveEdge(routed, selector);
  const points = edge.geometry.points;
  const segments = edgeSegments(points);
  const seg = segments[segIndex];
  if (!seg) {
    throw new Error(
      `Segment ${segIndex} does not exist on ${edge.key} (valid segments: 0..${segments.length - 1}).`,
    );
  }
  if (seg.shiftAxis === null || seg.coord === null) {
    throw new Error(`Segment ${segIndex} on ${edge.key} is diagonal and cannot be shifted orthogonally.`);
  }

  let offset = options.at !== undefined ? options.at - seg.coord : (options.delta as number);
  if (options.snap) {
    const targetCoord = snapToGrid(seg.coord + offset);
    offset = targetCoord - seg.coord;
  }

  const deltaPoint: Point = seg.shiftAxis === "x" ? { x: offset, y: 0 } : { x: 0, y: offset };
  const drawn = simplify(dragSegment(points, segIndex, deltaPoint));

  const sourceBox = boxes.get(edge.source) as Box;
  const targetBox = boxes.get(edge.target) as Box;
  if (
    drawn.length >= 3 &&
    !reanchor(
      drawn,
      anchor(sourceBox, edge.sourceSide),
      edge.sourceSide,
      anchor(targetBox, edge.targetSide),
      edge.targetSide,
    )
  ) {
    throw new Error(
      `Shifting segment ${segIndex} by ${round2(offset)}px would reverse the edge into ${edge.source} (${edge.sourceSide}) or ${edge.target} (${edge.targetSide}). Try a smaller shift or change sides with 'edge route'.`,
    );
  }

  const nextOverride: EdgeOverride = {
    source: edge.sourceSide,
    target: edge.targetSide,
    points: drawn.map(roundPoint),
  };
  const nextWorkspace: CliWorkspace = {
    ...workspace,
    edges: { ...workspace.edges, [edge.key]: nextOverride },
  };
  const updatedRouted = routeEdges(nextWorkspace.cfg, boxes, nextWorkspace.edges);
  const updated = updatedRouted[index] as RoutedEdge;
  return {
    workspace: nextWorkspace,
    edge: inspectRoutedEdge(updated, index, nextWorkspace.edges),
  };
}

/** Sets an explicit orthogonal polyline (or intermediate `--via` waypoints) for an edge. */
export function setEdgePoints(
  workspace: CliWorkspace,
  selector: string,
  options: { points?: Point[]; via?: Point[]; from?: Side; to?: Side },
): { workspace: CliWorkspace; edge: EdgeInspection } {
  if (!options.points && !options.via) {
    throw new Error("Specify either full points or --via intermediate waypoints.");
  }
  if (options.points && options.via) {
    throw new Error("Specify either full points or --via, not both.");
  }

  const boxes = nodeBoxes(workspace.cfg, workspace.positions);
  const routed = routeEdges(workspace.cfg, boxes, workspace.edges);
  const { edge, index } = resolveEdge(routed, selector);

  const sourceSide = options.from ?? edge.sourceSide;
  const targetSide = options.to ?? edge.targetSide;
  const sourceBox = boxes.get(edge.source) as Box;
  const targetBox = boxes.get(edge.target) as Box;
  const s = anchor(sourceBox, sourceSide);
  const t = anchor(targetBox, targetSide);

  const raw = options.via ? [s, ...options.via, t] : (options.points as Point[]);
  if (raw.length < 2) {
    throw new Error("An edge polyline must contain at least 2 points.");
  }

  for (let i = 0; i < raw.length - 1; i++) {
    const a = raw[i] as Point;
    const b = raw[i + 1] as Point;
    const dx = Math.abs(b.x - a.x);
    const dy = Math.abs(b.y - a.y);
    if (dx >= 0.5 && dy >= 0.5) {
      throw new Error(
        `Segment ${i} from (${round2(a.x)}, ${round2(a.y)}) to (${round2(b.x)}, ${round2(b.y)}) is diagonal. Every consecutive pair must share either x or y. (Source anchor on '${sourceSide}' is (${round2(s.x)}, ${round2(s.y)}); target anchor on '${targetSide}' is (${round2(t.x)}, ${round2(t.y)}).)`,
      );
    }
  }

  const simplified = simplify(raw);
  if (simplified.length < 2) {
    throw new Error("Edge points collapsed to fewer than 2 distinct points.");
  }

  let finalPoints: Point[] | undefined;
  if (simplified.length >= 3) {
    const anchored = reanchor(simplified, s, sourceSide, t, targetSide);
    if (!anchored) {
      throw new Error(
        `Route does not leave '${edge.source}' outward from '${sourceSide}' (${round2(s.x)}, ${round2(s.y)}) or enter '${edge.target}' into '${targetSide}' (${round2(t.x)}, ${round2(t.y)}). Adjust the first/last waypoints or pass --from/--to.`,
      );
    }
    finalPoints = anchored.map(roundPoint);
  } else {
    const [a, b] = simplified as [Point, Point];
    if (!segmentLeavesSide(a, b, sourceSide) || !segmentLeavesSide(b, a, targetSide)) {
      throw new Error(
        `Straight segment does not align with sides '${sourceSide}' -> '${targetSide}'. Pass --from/--to or add intermediate bend points.`,
      );
    }
  }

  const nextOverride: EdgeOverride = {
    source: sourceSide,
    target: targetSide,
    ...(finalPoints ? { points: finalPoints } : {}),
  };

  const nextWorkspace: CliWorkspace = {
    ...workspace,
    edges: { ...workspace.edges, [edge.key]: nextOverride },
  };
  const updatedRouted = routeEdges(nextWorkspace.cfg, boxes, nextWorkspace.edges);
  const updated = updatedRouted[index] as RoutedEdge;
  return {
    workspace: nextWorkspace,
    edge: inspectRoutedEdge(updated, index, nextWorkspace.edges),
  };
}

/** Resets one edge or all edges back to automatic routing (matching double-clicking an edge in the UI). */
export function resetEdge(
  workspace: CliWorkspace,
  target: string | { all: true },
): { workspace: CliWorkspace; resetCount: number; edge?: EdgeInspection } {
  if (typeof target !== "string") {
    const resetCount = Object.keys(workspace.edges).length;
    return { workspace: { ...workspace, edges: {} }, resetCount };
  }
  const boxes = nodeBoxes(workspace.cfg, workspace.positions);
  const routed = routeEdges(workspace.cfg, boxes, workspace.edges);
  const { edge, index } = resolveEdge(routed, target);
  const hadOverride = edge.key in workspace.edges;
  const { [edge.key]: _, ...rest } = workspace.edges;
  const nextWorkspace: CliWorkspace = { ...workspace, edges: rest };
  const updatedRouted = routeEdges(nextWorkspace.cfg, boxes, nextWorkspace.edges);
  return {
    workspace: nextWorkspace,
    resetCount: hadOverride ? 1 : 0,
    edge: inspectRoutedEdge(updatedRouted[index] as RoutedEdge, index, nextWorkspace.edges),
  };
}

/** Applies a list of batch operations atomically; throws before returning if any op fails. */
export function applyBatchOps(
  workspace: CliWorkspace,
  ops: BatchOp[],
): { workspace: CliWorkspace; applied: number } {
  let current = workspace;
  for (const [i, op] of ops.entries()) {
    try {
      current = applySingleOp(current, op);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(`Operation #${i} (${op.op}) failed: ${msg}`, { cause: error });
    }
  }
  return { workspace: current, applied: ops.length };
}

function applySingleOp(workspace: CliWorkspace, op: BatchOp): CliWorkspace {
  switch (op.op) {
    case "source":
      return updateWorkspaceSource(workspace, op.code).workspace;
    case "granularity":
      return setWorkspaceGranularity(workspace, parseGranularity(op.value)).workspace;
    case "language":
      return setWorkspaceLanguage(workspace, parseLanguage(op.value), op.code).workspace;
    case "tidy":
      return tidyWorkspace(workspace);
    case "node.move": {
      const ids = Array.isArray(op.id) ? op.id : [op.id];
      return moveNodes(workspace, ids, op).workspace;
    }
    case "edge.route":
      return routeEdgeSides(workspace, op.edge, {
        ...(op.from !== undefined ? { from: parseSide(op.from) } : {}),
        ...(op.to !== undefined ? { to: parseSide(op.to) } : {}),
      }).workspace;
    case "edge.shift":
      return shiftEdgeSegment(workspace, op.edge, op.segment, {
        ...(op.delta !== undefined ? { delta: op.delta } : {}),
        ...(op.at !== undefined ? { at: op.at } : {}),
        ...(op.snap !== undefined ? { snap: op.snap } : {}),
      }).workspace;
    case "edge.points":
      return setEdgePoints(workspace, op.edge, {
        ...(op.points !== undefined ? { points: op.points } : {}),
        ...(op.via !== undefined ? { via: op.via } : {}),
        ...(op.from !== undefined ? { from: parseSide(op.from) } : {}),
        ...(op.to !== undefined ? { to: parseSide(op.to) } : {}),
      }).workspace;
    case "edge.reset":
      if (op.all) return resetEdge(workspace, { all: true }).workspace;
      if (!op.edge) throw new Error("edge.reset requires 'edge' or 'all: true'.");
      return resetEdge(workspace, op.edge).workspace;
  }
}

/** Parses `"x1,y1 x2,y2 ..."` or `"x1,y1;x2,y2"` or JSON point array into `Point[]`. */
export function parsePointList(raw: string): Point[] {
  const trimmed = raw.trim();
  if (trimmed.startsWith("[")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new Error(`Invalid JSON point list: ${raw}`);
    }
    if (!Array.isArray(parsed)) throw new Error("Point list JSON must be an array.");
    return parsed.map((item, idx) => {
      if (Array.isArray(item) && item.length === 2 && isFiniteNum(item[0]) && isFiniteNum(item[1])) {
        return { x: item[0], y: item[1] };
      }
      if (
        typeof item === "object" &&
        item !== null &&
        isFiniteNum((item as Record<string, unknown>).x) &&
        isFiniteNum((item as Record<string, unknown>).y)
      ) {
        return {
          x: (item as Record<string, number>).x as number,
          y: (item as Record<string, number>).y as number,
        };
      }
      throw new Error(`Invalid point at index ${idx}: expected {x, y} or [x, y].`);
    });
  }

  const tokens = trimmed
    .split(/[\s;]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  if (tokens.length === 0) throw new Error("Point list is empty.");
  return tokens.map((token) => {
    const parts = token.split(",");
    if (parts.length !== 2) {
      throw new Error(`Invalid point '${token}'. Expected 'x,y' (e.g. '120,240').`);
    }
    const x = Number(parts[0]);
    const y = Number(parts[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error(`Invalid coordinates in point '${token}'.`);
    }
    return { x, y };
  });
}

function keepValidEdges(edges: EdgeOverrides, cfg: SavedWorkspace["cfg"]): EdgeOverrides {
  const valid = new Set(cfg.edges.map(edgeKey));
  return Object.fromEntries(Object.entries(edges).filter(([key]) => valid.has(key)));
}

function segmentLeavesSide(a: Point, b: Point, side: Side): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 0.5) return false;
  const ux = dx / len;
  const uy = dy / len;
  switch (side) {
    case "top":
      return uy < -0.5;
    case "bottom":
      return uy > 0.5;
    case "left":
      return ux < -0.5;
    case "right":
      return ux > 0.5;
  }
}

function computeBounds(boxes: Map<string, Box>, routed: RoutedEdge[]) {
  const allBoxes = [
    ...boxes.values(),
    ...routed.flatMap((e) => e.geometry.points.map((p) => ({ x: p.x, y: p.y, width: 0, height: 0 }))),
  ];
  if (allBoxes.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  const minX = Math.min(...allBoxes.map((b) => b.x));
  const minY = Math.min(...allBoxes.map((b) => b.y));
  const maxX = Math.max(...allBoxes.map((b) => b.x + b.width));
  const maxY = Math.max(...allBoxes.map((b) => b.y + b.height));
  return {
    minX: round2(minX),
    minY: round2(minY),
    maxX: round2(maxX),
    maxY: round2(maxY),
    width: round2(maxX - minX),
    height: round2(maxY - minY),
  };
}

const isFiniteNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const snapToGrid = (value: number) => Math.round(value / SNAP_GRID) * SNAP_GRID;
const round2 = (value: number) => Math.round(value * 100) / 100;
const roundPoint = (p: Point): Point => ({ x: round2(p.x), y: round2(p.y) });
