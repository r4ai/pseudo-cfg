import type { Cfg, CfgNode } from "./build-cfg";

/**
 * Carries node ids over from the previous graph so that positions survive edits.
 *
 * Nodes are compared in build order (which follows the source). Identical nodes are
 * aligned with a longest common subsequence; leftover nodes of the same kind between
 * two aligned pairs are treated as edited in place and also keep their id.
 *
 * @returns `next` with ids replaced; unmatched nodes get ids from `createId`.
 */
export function reconcile(prev: Cfg, next: Cfg, createId: () => string): Cfg {
  const matches = alignByLabel(prev.nodes, next.nodes);
  pairEditedNodes(prev.nodes, next.nodes, matches);

  const idMap = new Map<string, string>();
  next.nodes.forEach((node, j) => {
    const i = matches.get(j);
    idMap.set(node.id, i === undefined ? createId() : (prev.nodes[i]?.id ?? createId()));
  });
  const rename = (id: string) => idMap.get(id) ?? id;

  return {
    nodes: next.nodes.map((node) => ({ ...node, id: rename(node.id) })),
    edges: next.edges.map((edge) => ({ ...edge, source: rename(edge.source), target: rename(edge.target) })),
  };
}

const signature = (node: CfgNode) => `${node.kind}\u0000${node.label}`;

/**
 * Maps indices of `b` to indices of `a` along their longest common subsequence.
 * An edit usually touches a few nodes, so the common prefix and suffix are matched
 * directly and the quadratic table only covers the part in between.
 */
function alignByLabel(a: CfgNode[], b: CfgNode[]): Map<number, number> {
  const sa = a.map(signature);
  const sb = b.map(signature);
  const matches = new Map<number, number>();

  let start = 0;
  while (start < sa.length && start < sb.length && sa[start] === sb[start]) {
    matches.set(start, start);
    start++;
  }
  let endA = sa.length;
  let endB = sb.length;
  while (endA > start && endB > start && sa[endA - 1] === sb[endB - 1]) {
    endA--;
    endB--;
    matches.set(endB, endA);
  }

  const rows = endA - start + 1;
  const cols = endB - start + 1;
  const table = new Uint32Array(rows * cols);
  const at = (i: number, j: number) => table[(i - start) * cols + (j - start)] ?? 0;
  for (let i = endA - 1; i >= start; i--) {
    for (let j = endB - 1; j >= start; j--) {
      table[(i - start) * cols + (j - start)] =
        sa[i] === sb[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1));
    }
  }

  let i = start;
  let j = start;
  while (i < endA && j < endB) {
    if (sa[i] === sb[j]) {
      matches.set(j++, i++);
    } else if (at(i + 1, j) >= at(i, j + 1)) {
      i++;
    } else {
      j++;
    }
  }
  return matches;
}

/** Within each gap between aligned pairs, pairs remaining nodes of the same kind in order. */
function pairEditedNodes(a: CfgNode[], b: CfgNode[], matches: Map<number, number>) {
  const anchors = [...matches.entries()].toSorted(([x], [y]) => x - y);
  anchors.push([b.length, a.length]);
  let prevJ = -1;
  let prevI = -1;
  for (const [anchorJ, anchorI] of anchors) {
    const gapA = range(prevI + 1, anchorI);
    for (let j = prevJ + 1; j < anchorJ; j++) {
      const k = gapA.findIndex((i) => a[i]?.kind === b[j]?.kind);
      if (k < 0) continue;
      matches.set(j, gapA[k] as number);
      gapA.splice(0, k + 1);
    }
    prevJ = anchorJ;
    prevI = anchorI;
  }
}

function range(from: number, to: number): number[] {
  return Array.from({ length: Math.max(0, to - from) }, (_, k) => from + k);
}
