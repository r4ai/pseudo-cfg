import type { Cfg, CfgEdge, CfgNode } from "@/features/cfg/build-cfg";
import type { Positions, Size } from "./layout";

const GAP_X = 40;
const GAP_Y = 44;

/** Nodes placed relative to a spine: `cx` is a node's center from the spine, `y` its top. */
type Fragment = {
  at: Map<string, { cx: number; y: number }>;
  left: number;
  right: number;
  height: number;
};

const empty = (): Fragment => ({ at: new Map(), left: 0, right: 0, height: 0 });

const YES = new Set(["True", "next"]);
const NO = new Set(["False", "done"]);

/**
 * Lays out one scope the way the code reads, so every graph follows the same rules:
 * the main flow runs straight down, the path taken when a condition holds continues
 * below it, and the other path (False, done) opens a column to the right. Loop bodies
 * hang below their header. `break`, `return` and `raise` are jumps and don't shape the
 * layout, so code after an early return stays in the main column.
 */
export function structuredLayout(
  cfg: Cfg,
  sizeOf: (node: CfgNode) => Size,
): { positions: Positions; width: number; height: number } {
  const byId = new Map(cfg.nodes.map((node) => [node.id, node]));
  const order = new Map(cfg.nodes.map((node, index) => [node.id, index]));
  const out = new Map<string, CfgEdge[]>();
  const loopHeads = new Set<string>();
  const jumps: CfgEdge[] = [];
  const loopsBack = new Map<string, Set<string>>();
  for (const edge of cfg.edges) {
    if (edge.back) {
      loopHeads.add(edge.target);
      loopsBack.set(edge.source, (loopsBack.get(edge.source) ?? new Set()).add(edge.target));
    }
    if (edge.jump) jumps.push(edge);
    if (edge.back || edge.jump) continue;
    out.set(edge.source, [...(out.get(edge.source) ?? []), edge]);
  }
  const exits = (id: string) => out.get(id) ?? [];
  const yes = (id: string) => exits(id).find((e) => e.label !== null && YES.has(e.label))?.target;
  const no = (id: string) => exits(id).find((e) => e.label !== null && NO.has(e.label))?.target;
  const isEnd = (id: string) => byId.get(id)?.kind === "end";

  const reach = new Map<string, Set<string>>();
  const reachable = (from: string): Set<string> => {
    const cached = reach.get(from);
    if (cached) return cached;
    const seen = new Set([from]);
    for (const id of seen) for (const edge of exits(id)) seen.add(edge.target);
    reach.set(from, seen);
    return seen;
  };
  /** Where the two paths of a branch meet again: their first common node in source order. */
  const firstCommon = (a: Set<string>, b: Set<string>): string | undefined => {
    let best: string | undefined;
    for (const id of a) {
      if (b.has(id) && (best === undefined || (order.get(id) ?? 0) < (order.get(best) ?? 0))) best = id;
    }
    return best;
  };
  /** Loop headers the flow from `from` goes back to. */
  const headsReached = (from: string): Set<string> => {
    const heads = new Set<string>();
    for (const id of reachable(from)) for (const head of loopsBack.get(id) ?? []) heads.add(head);
    return heads;
  };
  const join = (a: string | undefined, b: string | undefined): string | undefined => {
    if (a === undefined || b === undefined) return a ?? b;
    // Inside a loop both paths may only meet by going round again (if/else in a loop body).
    return firstCommon(reachable(a), reachable(b)) ?? firstCommon(headsReached(a), headsReached(b));
  };

  const placed = new Set<string>();

  const place = (frag: Fragment, node: CfgNode, cx: number, y: number) => {
    const { width, height } = sizeOf(node);
    frag.at.set(node.id, { cx, y });
    frag.left = Math.min(frag.left, cx - width / 2);
    frag.right = Math.max(frag.right, cx + width / 2);
    frag.height = Math.max(frag.height, y + height);
  };

  /** Lays out the flow from `start` until it reaches `stop`, a node already placed, or the end. */
  const sequence = (start: string | undefined, stop: string | undefined): Fragment => {
    const frag = empty();
    let y = 0;
    for (let id = start; id !== undefined && id !== stop && !placed.has(id) && !isEnd(id);) {
      const node = byId.get(id);
      if (!node) break;
      placed.add(id);
      place(frag, node, 0, y);
      y += sizeOf(node).height + GAP_Y;

      if (loopHeads.has(id) || node.kind === "loop") {
        const body = sequence(yes(id), id);
        attach(frag, body, 0, y);
        if (body.at.size > 0) y += body.height + GAP_Y;
        // A loop with no way out but `break` (`while True`) continues where the break goes.
        id =
          no(id) ??
          jumps.find((e) => body.at.has(e.source) && !body.at.has(e.target) && !isEnd(e.target))?.target;
      } else if (node.kind === "branch") {
        const t = yes(id);
        const f = no(id);
        // When True only jumps (`if c: break`, `if c: continue`), the code that follows is the
        // False path; it goes in the right column so True can leave straight down as always.
        // Paths that never meet otherwise end in jumps (`if x: return 0`); the False path is then
        // the code that follows the True body, so it continues below it.
        const meet = t === undefined ? stop : (join(t, f) ?? f);
        const then = sequence(t, meet);
        const otherwise = sequence(f, meet);
        attach(frag, then, 0, y);
        if (otherwise.at.size > 0) {
          const edge = Math.max(then.at.size > 0 ? then.right : 0, sizeOf(node).width / 2);
          attach(frag, otherwise, edge + GAP_X - otherwise.left, y);
        }
        const tallest = Math.max(then.height, otherwise.height);
        if (tallest > 0) y += tallest + GAP_Y;
        id = meet;
      } else {
        id = exits(id)[0]?.target;
      }
    }
    return frag;
  };

  const main = empty();
  const starts = cfg.nodes.filter((node) => node.kind === "start");
  for (const start of starts)
    attach(main, sequence(start.id, undefined), 0, main.height === 0 ? 0 : main.height + GAP_Y);

  // Code no path reaches (after a return, after an endless loop) goes in a column to the
  // right, level with the code just before it in the source.
  for (const node of cfg.nodes) {
    if (placed.has(node.id) || node.kind === "end") continue;
    const before = cfg.nodes.slice(0, order.get(node.id)).findLast((n) => main.at.has(n.id));
    const y = before ? (main.at.get(before.id)?.y ?? 0) : 0;
    const part = sequence(node.id, undefined);
    attach(main, part, main.right + GAP_X - part.left, y);
  }

  for (const node of cfg.nodes) {
    if (node.kind === "end" && !main.at.has(node.id)) {
      place(main, node, 0, main.at.size === 0 ? 0 : main.height + GAP_Y);
    }
  }

  const positions: Positions = {};
  for (const node of cfg.nodes) {
    const p = main.at.get(node.id);
    if (!p) continue;
    positions[node.id] = { x: p.cx - sizeOf(node).width / 2 - main.left, y: p.y };
  }
  return { positions, width: main.right - main.left, height: main.height };
}

/** Adds `part` to `frag`, its spine moved by `dx` and its top by `dy`. */
function attach(frag: Fragment, part: Fragment, dx: number, dy: number) {
  for (const [id, p] of part.at) frag.at.set(id, { cx: p.cx + dx, y: p.y + dy });
  if (part.at.size === 0) return;
  frag.left = Math.min(frag.left, part.left + dx);
  frag.right = Math.max(frag.right, part.right + dx);
  frag.height = Math.max(frag.height, part.height + dy);
}
