import { buildCfg, type CfgNode, type Granularity, type Language } from "@/features/cfg/build-cfg";
import type { Diagnostic } from "@/features/cfg/parse";
import { type Point, shortLabel, type Side } from "@/features/diagram/edge-route";
import { edgeKey, nodeBoxes, type RoutedEdge, routeEdges } from "@/features/diagram/geometry";
import { autoLayout } from "@/features/diagram/layout";
import {
  type CliWorkspace,
  createWorkspace,
  type MoveNodeOptions,
  moveNodes,
  parseGranularity,
  parseLanguage,
  parsePointList,
  parseSide,
  resolveEdge,
  routeEdgeSides,
  setEdgePoints,
  shiftEdgeSegment,
} from "./diagram-ops";
import { parseYaml, type YamlValue, yamlBlockString, yamlScalar } from "./yaml";

export type CompiledSpec = {
  workspace: CliWorkspace;
  diagnostics: Diagnostic[];
};

/**
 * Compiles a declarative YAML diagram specification into a `CliWorkspace`.
 *
 * The spec starts from structured auto-layout and overlays optional node
 * placements (`layout.nodes`) and edge adjustments (`layout.edges`) in
 * declaration order using flexible semantic, line, or ID selectors.
 */
export function compileYamlSpec(yamlText: string): CompiledSpec {
  const root = parseYaml(yamlText);
  if (!isPlainObject(root)) {
    throw new Error("Diagram YAML spec must be a mapping with at least a 'source' field.");
  }

  const source = root.source;
  if (typeof source !== "string") {
    throw new Error("Diagram YAML spec is missing required string field 'source'.");
  }

  const language: Language =
    root.language !== undefined
      ? parseLanguage(expectString(root.language, "language"))
      : root.lang !== undefined
        ? parseLanguage(expectString(root.lang, "lang"))
        : "python";

  const granularity: Granularity =
    root.granularity !== undefined
      ? parseGranularity(expectString(root.granularity, "granularity"))
      : "block";

  const { workspace: initial, diagnostics } = createWorkspace(source, { language, granularity });
  let workspace = initial;

  const layout = root.layout;
  if (layout === undefined || layout === null) {
    return { workspace, diagnostics };
  }
  if (!isPlainObject(layout)) {
    throw new Error("'layout' must be a mapping with optional 'nodes' and 'edges' sections.");
  }

  const globalSnap = layout.snap === true;

  if (layout.nodes !== undefined && layout.nodes !== null) {
    workspace = applyYamlNodes(workspace, layout.nodes, globalSnap);
  }
  if (layout.edges !== undefined && layout.edges !== null) {
    workspace = applyYamlEdges(workspace, layout.edges, globalSnap);
  }

  return { workspace, diagnostics };
}

/**
 * Resolves a node selector flexibly:
 * - Exact node ID (`n4`)
 * - Line selector (`L10`, `L10-12`, `L10:branch`)
 * - Exact label (raw or single-line normalized)
 * - Unique substring match (case-sensitive first, then case-insensitive)
 */
export function resolveSemanticNode(nodes: CfgNode[], selector: string): CfgNode {
  const trimmed = selector.trim();
  if (!trimmed) throw new Error("Empty node selector.");

  const byId = nodes.find((n) => n.id === trimmed);
  if (byId) return byId;

  const lineMatch = /^(?:L|line:)(\d+)(?:-(\d+))?(?::(start|end|block|branch|loop))?$/i.exec(trimmed);
  if (lineMatch) {
    const line = Number(lineMatch[1]);
    const endLine = lineMatch[2] ? Number(lineMatch[2]) : undefined;
    const kind = lineMatch[3]?.toLowerCase();
    const candidates = nodes.filter((n) => {
      if (kind && n.kind !== kind) return false;
      if (endLine !== undefined) return n.line === line && n.endLine === endLine;
      return n.line <= line && line <= n.endLine && n.kind !== "end";
    });
    if (candidates.length === 1) return candidates[0] as CfgNode;
    if (candidates.length > 1) {
      throw new Error(`Ambiguous node selector '${selector}'. Matches: ${describeNodes(candidates)}`);
    }
    throw new Error(`No node found at '${selector}'. Available nodes: ${describeNodes(nodes)}`);
  }

  const exact = nodes.filter((n) => n.label === trimmed || normalizeLabel(n.label) === trimmed);
  if (exact.length === 1) return exact[0] as CfgNode;
  if (exact.length > 1) {
    throw new Error(
      `Ambiguous node selector '${selector}' (multiple nodes share that label). Use an ID or line selector instead: ${describeNodes(exact)}`,
    );
  }

  const sub = nodes.filter((n) => n.label.includes(trimmed) || normalizeLabel(n.label).includes(trimmed));
  if (sub.length === 1) return sub[0] as CfgNode;
  if (sub.length > 1) {
    throw new Error(
      `Ambiguous node selector '${selector}'. Matches: ${describeNodes(sub)}. Be more specific or use node ID (e.g. '${(sub[0] as CfgNode).id}').`,
    );
  }

  const lower = trimmed.toLowerCase();
  const ciSub = nodes.filter(
    (n) => n.label.toLowerCase().includes(lower) || normalizeLabel(n.label).toLowerCase().includes(lower),
  );
  if (ciSub.length === 1) return ciSub[0] as CfgNode;
  if (ciSub.length > 1) {
    throw new Error(`Ambiguous node selector '${selector}'. Matches: ${describeNodes(ciSub)}`);
  }

  throw new Error(`Node '${selector}' not found. Available nodes: ${describeNodes(nodes)}`);
}

/**
 * Resolves an edge selector supporting everything `resolveEdge` accepts plus
 * semantic node selectors on either side of `->`:
 * - `e4`, `n4->n6:F`, `n4>n6:False`
 * - `if x > 0 -> else_body [F]`
 * - `i = i + 1 -> while i < n [back]`
 */
export function resolveSemanticEdge(
  nodes: CfgNode[],
  routed: RoutedEdge[],
  selector: string,
): { edge: RoutedEdge; index: number } {
  const trimmed = selector.trim();

  try {
    return resolveEdge(routed, trimmed);
  } catch {
    // Fall through to semantic endpoint resolution.
  }

  const arrowIdx = trimmed.indexOf("->");
  if (arrowIdx < 0) {
    return resolveEdge(routed, trimmed);
  }

  const srcSelector = trimmed.slice(0, arrowIdx).trim();
  let rhs = trimmed.slice(arrowIdx + 2).trim();
  let tag: string | undefined;

  const bracketTag = /\s*\[([^\]]+)\]\s*$/.exec(rhs);
  if (bracketTag) {
    tag = (bracketTag[1] as string).trim();
    rhs = rhs.slice(0, bracketTag.index).trim();
  } else {
    const colonTag = /\s+:\s*([^\s]+)\s*$/.exec(rhs);
    if (colonTag) {
      tag = (colonTag[1] as string).trim();
      rhs = rhs.slice(0, colonTag.index).trim();
    }
  }

  const srcNode = resolveSemanticNode(nodes, srcSelector);
  const tgtNode = resolveSemanticNode(nodes, rhs);

  const candidates = routed
    .map((edge, index) => ({ edge, index }))
    .filter(({ edge }) => edge.source === srcNode.id && edge.target === tgtNode.id);

  if (candidates.length === 0) {
    const outgoing = routed
      .map((edge, index) => ({ edge, index }))
      .filter(({ edge }) => edge.source === srcNode.id);
    const hint =
      outgoing.length > 0
        ? ` Outgoing edges from ${srcNode.id}: ${outgoing.map(({ edge, index }) => `e${index} (${edge.source}->${edge.target}${edge.label ? `:${shortLabel(edge.label)}` : ""})`).join(", ")}`
        : "";
    throw new Error(`No edge from '${srcSelector}' (${srcNode.id}) to '${rhs}' (${tgtNode.id}).${hint}`);
  }

  if (!tag) {
    if (candidates.length === 1) return candidates[0] as { edge: RoutedEdge; index: number };
    throw new Error(
      `Ambiguous edge '${selector}'. Matches: ${candidates.map(({ edge, index }) => `e${index} (${edge.key})`).join(", ")}`,
    );
  }

  const tags = tag
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  const filtered = candidates.filter(({ edge }) => matchesTags(edge, tags));
  if (filtered.length === 1) return filtered[0] as { edge: RoutedEdge; index: number };
  if (filtered.length > 1) {
    throw new Error(
      `Ambiguous edge '${selector}'. Matches: ${filtered.map(({ edge, index }) => `e${index} (${edge.key})`).join(", ")}`,
    );
  }
  throw new Error(
    `No edge matched '${selector}'. Candidates between ${srcNode.id} and ${tgtNode.id}: ${candidates.map(({ edge, index }) => `e${index} (${edge.key})`).join(", ")}`,
  );
}

/**
 * Whether a workspace has any layout/edge customizations or non-default granularity
 * beyond plain auto-layout (used to decide `#spec=...` vs compact `#code=...` share URLs).
 */
export function hasCustomLayout(
  workspace: Pick<CliWorkspace, "source" | "language" | "granularity" | "cfg" | "positions" | "edges">,
): boolean {
  if (workspace.granularity !== "block") return true;
  if (Object.keys(workspace.edges).length > 0) return true;
  const auto = autoLayout(workspace.cfg);
  return workspace.cfg.nodes.some((node) => {
    const cur = workspace.positions[node.id];
    const base = auto[node.id];
    if (!cur || !base) return false;
    return Math.abs(cur.x - base.x) >= 0.5 || Math.abs(cur.y - base.y) >= 0.5;
  });
}

/**
 * Exports any workspace (including browser workspaces whose node IDs are random UUIDs)
 * as a portable declarative YAML overlay spec using canonical `n0`, `n1`, ... IDs so
 * `compileYamlSpec(workspaceToYaml(w))` always round-trips losslessly.
 */
export function workspaceToYaml(
  workspace: Pick<CliWorkspace, "source" | "language" | "granularity" | "cfg" | "positions" | "edges">,
): string {
  const fresh = buildCfg(workspace.source, workspace.granularity, workspace.language).cfg;
  const idMap = mapToCanonicalIds(workspace.cfg.nodes, fresh.nodes);
  const canonicalAuto = autoLayout(fresh);

  const lines: string[] = [];
  lines.push(`language: ${workspace.language}`);
  lines.push(`granularity: ${workspace.granularity}`);
  lines.push(`source: ${yamlBlockString(workspace.source, 2)}`);

  const movedNodes: { canonicalId: string; label: string; x: number; y: number }[] = [];
  for (const node of workspace.cfg.nodes) {
    const canonicalId = idMap.get(node.id);
    const cur = workspace.positions[node.id];
    const base = canonicalId ? canonicalAuto[canonicalId] : undefined;
    if (!canonicalId || !cur || !base) continue;
    if (Math.abs(cur.x - base.x) >= 0.5 || Math.abs(cur.y - base.y) >= 0.5) {
      movedNodes.push({
        canonicalId,
        label: normalizeLabel(node.label),
        x: round2(cur.x),
        y: round2(cur.y),
      });
    }
  }

  const edgeOverrides: { canonicalKey: string; override: NonNullable<CliWorkspace["edges"][string]> }[] = [];
  for (const edge of workspace.cfg.edges) {
    const oldKey = edgeKey(edge);
    const override = workspace.edges[oldKey];
    if (!override) continue;
    const src = idMap.get(edge.source);
    const tgt = idMap.get(edge.target);
    if (!src || !tgt) continue;
    const canonicalKey = edgeKey({ ...edge, source: src, target: tgt });
    edgeOverrides.push({ canonicalKey, override });
  }

  if (movedNodes.length > 0 || edgeOverrides.length > 0) {
    lines.push("");
    lines.push("layout:");
    if (movedNodes.length > 0) {
      lines.push("  nodes:");
      for (const item of movedNodes) {
        const comment = item.label.length <= 44 ? ` # ${item.label}` : "";
        lines.push(`    ${yamlScalar(item.canonicalId)}: { x: ${item.x}, y: ${item.y} }${comment}`);
      }
    }
    if (edgeOverrides.length > 0) {
      lines.push("  edges:");
      for (const { canonicalKey, override } of edgeOverrides) {
        lines.push(`    ${yamlScalar(canonicalKey)}:`);
        if (override.source) lines.push(`      from: ${override.source}`);
        if (override.target) lines.push(`      to: ${override.target}`);
        if (override.points && override.points.length > 0) {
          const pts = override.points.map((p) => `[${round2(p.x)}, ${round2(p.y)}]`).join(", ");
          lines.push(`      points: [${pts}]`);
        }
      }
    }
  }

  return `${lines.join("\n")}\n`;
}

/** Maps runtime node IDs (possibly random browser UUIDs) to fresh canonical `n0..` IDs. */
function mapToCanonicalIds(currentNodes: CfgNode[], freshNodes: CfgNode[]): Map<string, string> {
  const map = new Map<string, string>();
  const used = new Set<number>();

  // Fast path: 1-to-1 order match (true whenever `cfg` was built from the same `source`).
  if (
    currentNodes.length === freshNodes.length &&
    currentNodes.every((n, i) => {
      const f = freshNodes[i];
      return f !== undefined && f.kind === n.kind && f.label === n.label;
    })
  ) {
    for (let i = 0; i < currentNodes.length; i++) {
      map.set((currentNodes[i] as CfgNode).id, (freshNodes[i] as CfgNode).id);
    }
    return map;
  }

  // Fallback: greedy match by (kind, label) in order.
  for (const node of currentNodes) {
    const idx = freshNodes.findIndex(
      (f, i) => !used.has(i) && f.kind === node.kind && f.label === node.label,
    );
    if (idx >= 0) {
      used.add(idx);
      map.set(node.id, (freshNodes[idx] as CfgNode).id);
    }
  }
  return map;
}

/** Heuristic: whether raw text looks like a declarative pseudo-cfg YAML spec rather than Python/CUDA code. */
export function looksLikeYamlSpec(text: string): boolean {
  const lines = text.split(/\r?\n/);
  let hasSource = false;
  let hasMeta = false;
  for (const raw of lines) {
    const trimmed = raw.trim();
    if (trimmed === "" || trimmed.startsWith("#") || trimmed === "---") continue;
    if (/^source\s*:\s*/.test(raw)) hasSource = true;
    if (/^(?:language|lang|granularity|layout)\s*:\s*/.test(raw)) hasMeta = true;
    if (/^(?:def |class |if |for |while |import |from |__global__|__device__|int |void |float )/.test(raw)) {
      return false;
    }
  }
  return hasSource && (hasMeta || /^source\s*:\s*[|>]/m.test(text));
}

function applyYamlNodes(workspace: CliWorkspace, nodesSpec: YamlValue, globalSnap: boolean): CliWorkspace {
  const entries = normalizeNodeEntries(nodesSpec);
  let current = workspace;
  for (const { selector, spec } of entries) {
    const targetNode = resolveSemanticNode(current.cfg.nodes, selector);
    const refId = (val: YamlValue | undefined, field: string): string | undefined => {
      if (val === undefined || val === null) return undefined;
      return resolveSemanticNode(current.cfg.nodes, expectString(val, field)).id;
    };

    const opts: MoveNodeOptions = {};
    const x = optNumber(spec, ["x"]);
    const y = optNumber(spec, ["y"]);
    const cx = optNumber(spec, ["cx"]);
    const cy = optNumber(spec, ["cy"]);
    const dx = optNumber(spec, ["dx"]);
    const dy = optNumber(spec, ["dy"]);
    const gap = optNumber(spec, ["gap"]);
    const below = refId(pick(spec, ["below"]), "below");
    const above = refId(pick(spec, ["above"]), "above");
    const leftOf = refId(pick(spec, ["leftOf", "left-of", "left_of"]), "leftOf");
    const rightOf = refId(pick(spec, ["rightOf", "right-of", "right_of"]), "rightOf");
    const alignX = refId(pick(spec, ["alignX", "align-x", "align_x"]), "alignX");
    const alignY = refId(pick(spec, ["alignY", "align-y", "align_y"]), "alignY");
    const snapVal = pick(spec, ["snap"]);
    const snap = typeof snapVal === "boolean" ? snapVal : globalSnap;

    if (x !== undefined) opts.x = x;
    if (y !== undefined) opts.y = y;
    if (cx !== undefined) opts.cx = cx;
    if (cy !== undefined) opts.cy = cy;
    if (dx !== undefined) opts.dx = dx;
    if (dy !== undefined) opts.dy = dy;
    if (gap !== undefined) opts.gap = gap;
    if (below !== undefined) opts.below = below;
    if (above !== undefined) opts.above = above;
    if (leftOf !== undefined) opts.leftOf = leftOf;
    if (rightOf !== undefined) opts.rightOf = rightOf;
    if (alignX !== undefined) opts.alignX = alignX;
    if (alignY !== undefined) opts.alignY = alignY;
    if (snap) opts.snap = true;

    current = moveNodes(current, [targetNode.id], opts).workspace;
  }
  return current;
}

function applyYamlEdges(workspace: CliWorkspace, edgesSpec: YamlValue, globalSnap: boolean): CliWorkspace {
  const entries = normalizeEdgeEntries(edgesSpec);
  let current = workspace;
  for (const { selector, spec } of entries) {
    const boxes = nodeBoxes(current.cfg, current.positions);
    const routed = routeEdges(current.cfg, boxes, current.edges);
    const { edge } = resolveSemanticEdge(current.cfg.nodes, routed, selector);

    const fromRaw = pick(spec, ["from", "source", "sourceSide", "source_side"]);
    const toRaw = pick(spec, ["to", "target", "targetSide", "target_side"]);
    const from: Side | undefined =
      fromRaw !== undefined ? parseSide(expectString(fromRaw, "from")) : undefined;
    const to: Side | undefined = toRaw !== undefined ? parseSide(expectString(toRaw, "to")) : undefined;

    const pointsRaw = pick(spec, ["points"]);
    const viaRaw = pick(spec, ["via"]);
    const shiftRaw = pick(spec, ["shift", "shifts"]);

    if (pointsRaw !== undefined || viaRaw !== undefined) {
      const points = pointsRaw !== undefined ? parseYamlPoints(pointsRaw, "points") : undefined;
      const via = viaRaw !== undefined ? parseYamlPoints(viaRaw, "via") : undefined;
      current = setEdgePoints(current, edge.key, {
        ...(points !== undefined ? { points } : {}),
        ...(via !== undefined ? { via } : {}),
        ...(from !== undefined ? { from } : {}),
        ...(to !== undefined ? { to } : {}),
      }).workspace;
      continue;
    }

    if (from !== undefined || to !== undefined) {
      current = routeEdgeSides(current, edge.key, {
        ...(from !== undefined ? { from } : {}),
        ...(to !== undefined ? { to } : {}),
      }).workspace;
    }

    if (shiftRaw !== undefined && shiftRaw !== null) {
      const shiftList = Array.isArray(shiftRaw) ? shiftRaw : [shiftRaw];
      for (const item of shiftList) {
        if (!isPlainObject(item)) {
          throw new Error(`Edge '${selector}' shift entry must be a mapping { segment, delta | at }.`);
        }
        const seg = optNumber(item, ["segment", "seg", "index"]);
        if (seg === undefined || !Number.isInteger(seg)) {
          throw new Error(`Edge '${selector}' shift entry requires an integer 'segment'.`);
        }
        const delta = optNumber(item, ["delta", "by"]);
        const at = optNumber(item, ["at", "x", "y"]);
        const snapVal = pick(item, ["snap"]);
        const snap = typeof snapVal === "boolean" ? snapVal : globalSnap;
        current = shiftEdgeSegment(current, edge.key, seg, {
          ...(delta !== undefined ? { delta } : {}),
          ...(at !== undefined ? { at } : {}),
          ...(snap ? { snap: true } : {}),
        }).workspace;
      }
    }
  }
  return current;
}

function normalizeNodeEntries(val: YamlValue): { selector: string; spec: Record<string, YamlValue> }[] {
  if (isPlainObject(val)) {
    return Object.entries(val).map(([selector, spec]) => {
      if (!isPlainObject(spec)) {
        throw new Error(`layout.nodes['${selector}'] must be a mapping of placement properties.`);
      }
      return { selector, spec };
    });
  }
  if (Array.isArray(val)) {
    return val.map((item, idx) => {
      if (!isPlainObject(item)) throw new Error(`layout.nodes[${idx}] must be a mapping.`);
      const sel = pick(item, ["node", "id", "match", "target"]);
      if (typeof sel !== "string") {
        throw new Error(`layout.nodes[${idx}] must specify a string 'node' (or 'id') selector.`);
      }
      return { selector: sel, spec: item };
    });
  }
  throw new Error("'layout.nodes' must be a mapping (selector -> properties) or a list.");
}

function normalizeEdgeEntries(val: YamlValue): { selector: string; spec: Record<string, YamlValue> }[] {
  if (isPlainObject(val)) {
    return Object.entries(val).map(([selector, spec]) => {
      if (!isPlainObject(spec)) {
        throw new Error(`layout.edges['${selector}'] must be a mapping of routing properties.`);
      }
      return { selector, spec };
    });
  }
  if (Array.isArray(val)) {
    return val.map((item, idx) => {
      if (!isPlainObject(item)) throw new Error(`layout.edges[${idx}] must be a mapping.`);
      const sel = pick(item, ["edge", "match", "key"]);
      if (typeof sel !== "string") {
        throw new Error(`layout.edges[${idx}] must specify a string 'edge' selector.`);
      }
      return { selector: sel, spec: item };
    });
  }
  throw new Error("'layout.edges' must be a mapping (selector -> properties) or a list.");
}

function parseYamlPoints(val: YamlValue, field: string): Point[] {
  if (typeof val === "string") return parsePointList(val);
  if (!Array.isArray(val)) {
    throw new Error(`'${field}' must be a list of [x, y] / {x, y} points or an "x,y ..." string.`);
  }
  return val.map((item, idx) => {
    if (Array.isArray(item) && item.length === 2 && isNum(item[0]) && isNum(item[1])) {
      return { x: item[0], y: item[1] };
    }
    if (isPlainObject(item) && isNum(item.x) && isNum(item.y)) {
      return { x: item.x, y: item.y };
    }
    if (typeof item === "string") {
      const parsed = parsePointList(item);
      if (parsed.length === 1) return parsed[0] as Point;
    }
    throw new Error(`Invalid point at ${field}[${idx}]: expected [x, y], {x, y}, or "x,y".`);
  });
}

function matchesTags(edge: RoutedEdge, tags: string[]): boolean {
  for (const tag of tags) {
    const lower = tag.toLowerCase();
    if (lower === "back") {
      if (!edge.back) return false;
      continue;
    }
    if (lower === "jump") {
      if (!edge.jump) return false;
      continue;
    }
    if (edge.label === null) return false;
    if (edge.label.toLowerCase() !== lower && shortLabel(edge.label).toLowerCase() !== lower) {
      return false;
    }
  }
  return true;
}

function normalizeLabel(s: string): string {
  return s.replace(/\s*\n\s*/g, " ; ").trim();
}

function describeNodes(nodes: CfgNode[]): string {
  return nodes.map((n) => `${n.id} (L${n.line} ${JSON.stringify(normalizeLabel(n.label))})`).join(", ");
}

function pick(obj: Record<string, YamlValue>, keys: string[]): YamlValue | undefined {
  for (const key of keys) {
    if (key in obj && obj[key] !== undefined) return obj[key];
  }
  return undefined;
}

function optNumber(obj: Record<string, YamlValue>, keys: string[]): number | undefined {
  const val = pick(obj, keys);
  if (val === undefined || val === null) return undefined;
  if (typeof val === "number" && Number.isFinite(val)) return val;
  throw new Error(`Field '${keys[0]}' expects a number, got ${JSON.stringify(val)}.`);
}

function expectString(val: YamlValue, field: string): string {
  if (typeof val === "string") return val;
  throw new Error(`Field '${field}' expects a string, got ${JSON.stringify(val)}.`);
}

function isNum(val: unknown): val is number {
  return typeof val === "number" && Number.isFinite(val);
}

function isPlainObject(val: unknown): val is Record<string, YamlValue> {
  return typeof val === "object" && val !== null && !Array.isArray(val);
}

const round2 = (value: number) => Math.round(value * 100) / 100;
