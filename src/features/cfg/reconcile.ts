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

/** Maps indices of `b` to indices of `a` along their longest common subsequence. */
function alignByLabel(a: CfgNode[], b: CfgNode[]): Map<number, number> {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const table = new Uint32Array(rows * cols);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i * cols + j] =
        signature(a[i] as CfgNode) === signature(b[j] as CfgNode)
          ? (table[(i + 1) * cols + j + 1] ?? 0) + 1
          : Math.max(table[(i + 1) * cols + j] ?? 0, table[i * cols + j + 1] ?? 0);
    }
  }

  const matches = new Map<number, number>();
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (signature(a[i] as CfgNode) === signature(b[j] as CfgNode)) {
      matches.set(j++, i++);
    } else if ((table[(i + 1) * cols + j] ?? 0) >= (table[i * cols + j + 1] ?? 0)) {
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
