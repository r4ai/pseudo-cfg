import type { Diagnostic } from "@/features/cfg/parse";
import type { DiagramQualityReport } from "@/features/diagram/quality";
import type { EdgeInspection, NodeInspection, SegmentInfo, WorkspaceInspection } from "./workspace-ops";

export function formatInspection(info: WorkspaceInspection, label?: string): string {
  const lines: string[] = [];
  const header = label ? `${label} ` : "";
  lines.push(
    `${header}(${info.language}, ${info.granularity}) — ${info.nodes.length} nodes, ${info.edges.length} edges, ${info.diagnostics.length} diagnostics, ${info.quality.issueCount} layout issues`,
  );
  lines.push(
    `Bounds: x=${info.bounds.minX}..${info.bounds.maxX}, y=${info.bounds.minY}..${info.bounds.maxY} (${info.bounds.width}x${info.bounds.height})`,
  );

  lines.push("");
  lines.push("Nodes:");
  lines.push(...formatNodeTable(info.nodes));

  lines.push("");
  lines.push("Edges:");
  lines.push(...formatEdgeTable(info.edges));

  if (info.diagnostics.length > 0) {
    lines.push("");
    lines.push("Diagnostics:");
    lines.push(...formatDiagnostics(info.diagnostics));
  }

  if (!info.quality.ok || info.quality.hoppedCrossings > 0) {
    lines.push("");
    lines.push("Quality:");
    lines.push(...formatQuality(info.quality));
  }

  return `${lines.join("\n")}\n`;
}

export function formatNodeTable(nodes: NodeInspection[]): string[] {
  if (nodes.length === 0) return ["  (none)"];
  const idW = Math.max(2, ...nodes.map((n) => n.id.length));
  const kindW = 6;
  const lineW = Math.max(3, ...nodes.map((n) => lineRange(n).length));
  return nodes.map((n) => {
    const snippet = singleLineLabel(n.label, 38);
    return `  ${n.id.padEnd(idW)}  ${n.kind.padEnd(kindW)}  ${lineRange(n).padEnd(lineW)}  ${snippet.padEnd(40)}  pos=(${n.x}, ${n.y})  size=${n.width}x${n.height}  center=(${n.cx}, ${n.cy})`;
  });
}

export function formatEdgeTable(edges: EdgeInspection[]): string[] {
  if (edges.length === 0) return ["  (none)"];
  const handleW = Math.max(2, ...edges.map((e) => e.handle.length));
  const pairW = Math.max(7, ...edges.map((e) => `${e.source} -> ${e.target}`.length));
  return edges.map((e) => {
    const pair = `${e.source} -> ${e.target}`.padEnd(pairW);
    const tag = formatEdgeTags(e).padEnd(14);
    const sides = `${e.sourceSide.padEnd(6)} -> ${e.targetSide.padEnd(6)}`;
    const mode = e.mode.padEnd(6);
    const segCount = `${e.segments.length} seg${e.segments.length === 1 ? "" : "s"}`;
    const hops = e.hops.length > 0 ? `  ${e.hops.length} hop${e.hops.length === 1 ? "" : "s"}` : "";
    return `  ${e.handle.padEnd(handleW)}  ${pair}  ${tag}  ${sides}  ${mode}  ${segCount}${hops}`;
  });
}

export function formatEdgeDetail(edge: EdgeInspection): string {
  const lines: string[] = [];
  const tags = formatEdgeTags(edge);
  lines.push(
    `${edge.handle}  ${edge.source} -> ${edge.target}${tags ? `  ${tags}` : ""}  (${edge.sourceSide} -> ${edge.targetSide}, ${edge.mode})`,
  );
  lines.push(`  key: ${edge.key}`);
  lines.push(`  points: ${edge.points.map((p) => `(${p.x}, ${p.y})`).join(" -> ")}`);
  if (edge.label) {
    lines.push(`  label: "${edge.shortLabel}" (${edge.label}) at (${edge.labelAt.x}, ${edge.labelAt.y})`);
  }
  if (edge.hops.length > 0) {
    lines.push(`  hops: ${edge.hops.map((h) => `(${h.x}, ${h.y})`).join(", ")}`);
  }
  lines.push("  segments:");
  for (const seg of edge.segments) {
    lines.push(`    ${formatSegment(seg)}`);
  }
  return `${lines.join("\n")}\n`;
}

export function formatSegment(seg: SegmentInfo): string {
  const dir = seg.orientation === "horizontal" ? "H" : seg.orientation === "vertical" ? "V" : "D";
  const shiftHint =
    seg.shiftAxis === "x"
      ? `[shift X, x=${seg.coord}]`
      : seg.shiftAxis === "y"
        ? `[shift Y, y=${seg.coord}]`
        : "[diagonal]";
  return `seg ${seg.index} (${dir}): (${seg.from.x}, ${seg.from.y}) -> (${seg.to.x}, ${seg.to.y})  len=${seg.length}  ${shiftHint}`;
}

export function formatDiagnostics(diagnostics: Diagnostic[]): string[] {
  if (diagnostics.length === 0) return ["  (none)"];
  return diagnostics.map((d) => `  [${d.severity}] L${d.line}: ${d.message}`);
}

export function formatQuality(quality: DiagramQualityReport): string[] {
  const lines: string[] = [];
  if (quality.ok) {
    lines.push(
      `  OK — 0 issues (${quality.hoppedCrossings} hopped crossing${quality.hoppedCrossings === 1 ? "" : "s"})`,
    );
    return lines;
  }
  for (const item of quality.nodeOverlaps) {
    lines.push(`  [overlap] Nodes ${item.a} and ${item.b} overlap`);
  }
  for (const item of quality.edgesThroughNodes) {
    lines.push(`  [collision] Edge e${item.edgeIndex} (${item.edgeKey}) passes through node ${item.nodeId}`);
  }
  for (const item of quality.collinearEdgeOverlaps) {
    lines.push(`  [collinear] Edges e${item.edgeA} and e${item.edgeB} overlap for ${item.overlapLength}px`);
  }
  for (const item of quality.unhoppedCrossings) {
    lines.push(
      `  [crossing] Unhopped crossing between e${item.edgeA} and e${item.edgeB} at (${item.at.x}, ${item.at.y})`,
    );
  }
  for (const item of quality.coveredLabels) {
    lines.push(`  [label] Label '${item.label}' on e${item.edgeIndex} (${item.edgeKey}) is covered`);
  }
  if (quality.hoppedCrossings > 0) {
    lines.push(
      `  [info] ${quality.hoppedCrossings} hopped crossing${quality.hoppedCrossings === 1 ? "" : "s"}`,
    );
  }
  return lines;
}

function formatEdgeTags(edge: EdgeInspection): string {
  const parts: string[] = [];
  if (edge.shortLabel) parts.push(edge.shortLabel);
  if (edge.back) parts.push("back");
  if (edge.jump) parts.push("jump");
  return parts.length > 0 ? `[${parts.join(",")}]` : "";
}

function lineRange(node: NodeInspection): string {
  return node.line === node.endLine ? `L${node.line}` : `L${node.line}-${node.endLine}`;
}

function singleLineLabel(label: string, maxLen: number): string {
  const flat = label.replaceAll("\n", " ; ");
  const clipped = flat.length > maxLen ? `${flat.slice(0, maxLen - 1)}…` : flat;
  return JSON.stringify(clipped);
}
