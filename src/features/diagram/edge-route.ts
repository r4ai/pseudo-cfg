export type Point = { x: number; y: number };
export type Box = { x: number; y: number; width: number; height: number };

export type EdgeGeometry = {
  /** Orthogonal polyline from the source anchor to the target anchor. */
  points: Point[];
  /** Center of the label, beside the start of the line rather than on it. */
  labelAt: Point;
  /** Points on horizontal segments where another edge's vertical segment crosses; drawn as hops. */
  hops: Point[];
};

export type EdgeTone = "yes" | "no" | "plain";

/** Whether an edge label means the condition held (`True`, `next`) or not (`False`, `done`, `raise`). */
export function toneOf(label: string | null): EdgeTone {
  if (label === "True" || label === "next") return "yes";
  if (label === "False" || label === "done" || label === "raise") return "no";
  return "plain";
}

const LANE_GAP = 20;
/** How far from a flat top's corners an off-center edge may enter. */
const FLAT_INSET = 16;
const LABEL_GAP = 4;
const LABEL_HEIGHT = 16;
/** Radius of the arc a line draws to hop over one it crosses. */
const HOP = 5;

export type RouteOptions = {
  /**
   * Which way the edge leaves a branch, so outcomes always sit in the same place:
   * `yes` (True, next) leaves from the bottom, `no` (False, done) from the right vertex.
   * Other edges leave from the bottom.
   */
  exit?: "yes" | "no" | "plain";
  /** The target has a flat top, so an edge may enter it off-center to stay straight. */
  flatTarget?: boolean;
  /** Loop back edges run up on the left, apart from everything that leaves to the right. */
  back?: boolean;
  /** Jumps (break, return) skip whole blocks, so they run outside everything they pass. */
  outer?: boolean;
  /** Vertical lanes other edges already use; detours step past them instead of overlapping. */
  lanes?: Box[];
};

/**
 * Routes an edge from the nodes' current boxes, so edges stay readable however
 * the user arranges the diagram. Anchors are side midpoints, which coincide with
 * diamond and hexagon vertices, so the same rules work for every shape.
 *
 * Detours keep to one rule: whatever leaves (False, done, break, return) goes round
 * on the right, and loop back edges climb on the left.
 *
 * @param obstacles - Nodes the edge should avoid; `source` and `target` may be among them.
 */
export function routeEdge(
  source: Box,
  target: Box,
  obstacles: Box[],
  options: RouteOptions = {},
): EdgeGeometry {
  const { exit = "plain", flatTarget = false, back = false, outer = false, lanes = [] } = options;
  const sourceX = centerX(source);
  const others = () => obstacles.filter((o) => o !== source && o !== target);
  const t = top(target);

  if (back || target.y + target.height <= source.y) {
    // Loop back edge: leave below the source (or by the False vertex), climb in a lane left of
    // every node in between, and come into the loop header from above, where it joins the edge
    // entering the loop. Entering from above keeps the header's side vertices free for its exits.
    const s = exit === "no" ? right(source) : bottom(source);
    // A False exit steps out to the right and drops below its node before turning left.
    const below = source.y + source.height + LANE_GAP / 2;
    const above = t.y - LANE_GAP;
    const between = obstacles.filter((o) => o.y < below && o.y + o.height > above);
    let lane = Math.min(...[source, target, ...between].map((o) => o.x)) - 2 * LANE_GAP;
    const taken = lanes.filter((o) => o.y < below && o.y + o.height > above);
    for (let hit = laneHit(lane, taken); hit; hit = laneHit(lane, taken)) lane = hit.x - LANE_GAP / 2;
    const turn = exit === "no" ? s.x + LANE_GAP / 2 : s.x;
    const start = exit === "no" ? [s, { x: turn, y: s.y }] : [s];
    return withLabel([
      ...start,
      { x: turn, y: below },
      { x: lane, y: below },
      { x: lane, y: above },
      { x: t.x, y: above },
      t,
    ]);
  }

  if (exit === "no") {
    // The False exit always leaves to the right; a target further right is reached directly,
    // one below or to the left by going down a lane on the right.
    const s = right(source);
    const direct = [s, { x: t.x, y: s.y }, t];
    if (t.x > s.x && isClear(direct, others())) return withLabel(direct);
    return withLabel(detour([s], s.x + LANE_GAP, t, others(), lanes, outer));
  }

  const straight = target.x + FLAT_INSET <= sourceX && sourceX <= target.x + target.width - FLAT_INSET;
  const plumb = [bottom(source), { x: sourceX, y: target.y }];
  if (flatTarget && straight && isClear(plumb, others())) return withLabel(plumb);
  const down = dogleg(bottom(source), t, "vertical");
  if (isClear(down, others())) return withLabel(down);
  // Blocked on the way down (a return skipping the code below): drop out of the bottom and
  // go round on the right.
  const s = bottom(source);
  const drop = { x: s.x, y: s.y + LANE_GAP / 2 };
  return withLabel(detour([s, drop], source.x + source.width + LANE_GAP, t, others(), lanes, outer));
}

/**
 * Runs down a vertical lane from the last of `start`, stepping the lane outwards past any
 * node it would cross, and comes into `t` from just above it.
 */
function detour(
  start: Point[],
  lane: number,
  t: Point,
  obstacles: Box[],
  lanes: Box[],
  outer: boolean,
): Point[] {
  const from = start.at(-1) as Point;
  const approach = Math.max(from.y, t.y - LANE_GAP);
  const inTheWay = obstacles.filter((o) => o.y < approach && o.y + o.height > from.y);
  const taken = lanes.filter((o) => o.y < approach && o.y + o.height > from.y);
  let x = outer ? Math.max(lane, ...inTheWay.map((o) => o.x + o.width + LANE_GAP)) : lane;
  // Step right past nodes (a full gap) and past lanes in use (half a gap) until clear.
  for (;;) {
    const node = laneHit(x, inTheWay);
    const hit = node ?? laneHit(x, taken);
    if (!hit) break;
    x = hit.x + hit.width + (node ? LANE_GAP : LANE_GAP / 2);
  }
  return [...start, { x, y: from.y }, { x, y: approach }, { x: t.x, y: approach }, t];
}
/** Thin boxes around the vertical segments of a route, for `RouteOptions.lanes`. */
export function verticalLanes(points: Point[]): Box[] {
  const boxes: Box[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as Point;
    const b = points[i] as Point;
    if (Math.abs(a.x - b.x) > 0.5) continue;
    boxes.push({
      x: a.x - LANE_GAP / 4,
      y: Math.min(a.y, b.y),
      width: LANE_GAP / 2,
      height: Math.abs(a.y - b.y),
    });
  }
  return boxes;
}

/** Two-bend connection that splits the distance halfway along `axis`. */
function dogleg(s: Point, t: Point, axis: "vertical" | "horizontal"): Point[] {
  if (axis === "vertical") {
    if (Math.abs(s.x - t.x) < 0.5) return [s, t];
    const mid = (s.y + t.y) / 2;
    return [s, { x: s.x, y: mid }, { x: t.x, y: mid }, t];
  }
  if (Math.abs(s.y - t.y) < 0.5) return [s, t];
  const mid = (s.x + t.x) / 2;
  return [s, { x: mid, y: s.y }, { x: mid, y: t.y }, t];
}

function withLabel(points: Point[]): EdgeGeometry {
  return { points, labelAt: labelPosition(points, labelWidth("False")), hops: [] };
}

/** Width of an edge label pill, as drawn on the canvas and in exported images. */
export function labelWidth(label: string): number {
  return label.length * 6.5 + 12;
}

/**
 * Center of a label of `width` placed just past the start of the line and off to its
 * side (right of a vertical start, above a horizontal one), so it never hides where the
 * line leaves its node.
 */
export function labelPosition(points: Point[], width: number): Point {
  const [s, next] = points as [Point, Point];
  if (Math.abs(s.x - next.x) < 0.5) {
    const down = next.y > s.y ? 1 : -1;
    return { x: s.x + LABEL_GAP + width / 2, y: s.y + down * (LABEL_HEIGHT / 2 + LABEL_GAP) };
  }
  const dir = next.x > s.x ? 1 : -1;
  return { x: s.x + dir * (LABEL_GAP + width / 2), y: s.y - LABEL_HEIGHT / 2 - LABEL_GAP / 2 };
}
/** SVG path for a polyline with rounded corners, hopping over the lines it crosses at `hops`. */
export function roundedPath(points: Point[], radius = 8, hops: Point[] = []): string {
  const [first, ...rest] = points;
  if (!first) return "";
  let d = `M ${first.x} ${first.y}`;
  const lineTo = (from: Point, to: Point) => {
    if (Math.abs(from.y - to.y) < 0.5) {
      const dir = to.x > from.x ? 1 : -1;
      const on = hops
        .filter((h) => Math.abs(h.y - from.y) < 0.5 && (h.x - from.x) * dir > HOP && (to.x - h.x) * dir > HOP)
        .toSorted((a, b) => (a.x - b.x) * dir);
      // Clockwise from the left end (or anticlockwise from the right) bulges upwards.
      for (const h of on)
        d += ` L ${h.x - dir * HOP} ${h.y} A ${HOP} ${HOP} 0 0 ${dir > 0 ? 1 : 0} ${h.x + dir * HOP} ${h.y}`;
    }
    d += ` L ${to.x} ${to.y}`;
  };
  let cursor = first;
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1] as Point;
    const corner = points[i] as Point;
    const next = points[i + 1] as Point;
    const r = Math.min(radius, distance(prev, corner) / 2, distance(corner, next) / 2);
    const a = toward(corner, prev, r);
    const b = toward(corner, next, r);
    lineTo(cursor, a);
    d += ` Q ${corner.x} ${corner.y} ${b.x} ${b.y}`;
    cursor = b;
  }
  const last = rest.at(-1);
  if (last) lineTo(cursor, last);
  return d;
}

/**
 * Where each route's horizontal segments cross another route's vertical segments, away
 * from corners and ends, so merging edges (which meet at an end) are not hops.
 */
export function crossings(routes: Point[][]): Point[][] {
  const margin = 8 + HOP;
  const segments = (points: Point[], horizontal: boolean) =>
    points.slice(1).flatMap((b, i) => {
      const a = points[i] as Point;
      const isHorizontal = Math.abs(a.y - b.y) < 0.5 && Math.abs(a.x - b.x) >= 0.5;
      const isVertical = Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) >= 0.5;
      return (horizontal ? isHorizontal : isVertical) ? [[a, b] as const] : [];
    });
  const verticals = routes.map((points) => segments(points, false));
  return routes.map((points, i) =>
    segments(points, true).flatMap(([a, b]) => {
      const [x0, x1] = [Math.min(a.x, b.x), Math.max(a.x, b.x)];
      return verticals.flatMap((list, j) =>
        j === i
          ? []
          : list.flatMap(([c, d]) => {
              const [y0, y1] = [Math.min(c.y, d.y), Math.max(c.y, d.y)];
              const crosses =
                x0 + margin < c.x && c.x < x1 - margin && y0 + margin < a.y && a.y < y1 - margin;
              return crosses ? [{ x: c.x, y: a.y }] : [];
            }),
      );
    }),
  );
}
/** Arrowhead triangle at the end of the polyline, plus the polyline trimmed to the arrow's base. */
export function arrowhead(points: Point[], length = 9, halfWidth = 4.5): { line: Point[]; head: string } {
  const tip = points.at(-1) as Point;
  const from = points.at(-2) as Point;
  const d = unit(from, tip);
  const base = { x: tip.x - d.x * length, y: tip.y - d.y * length };
  const side = { x: -d.y * halfWidth, y: d.x * halfWidth };
  return {
    line: [...points.slice(0, -1), base],
    head: `${tip.x},${tip.y} ${base.x + side.x},${base.y + side.y} ${base.x - side.x},${base.y - side.y}`,
  };
}

const laneHit = (x: number, boxes: Box[]) => boxes.find((o) => o.x <= x && x <= o.x + o.width);

/** Whether an orthogonal polyline stays out of every box. */
function isClear(points: Point[], boxes: Box[]): boolean {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as Point;
    const b = points[i] as Point;
    const x0 = Math.min(a.x, b.x);
    const x1 = Math.max(a.x, b.x);
    const y0 = Math.min(a.y, b.y);
    const y1 = Math.max(a.y, b.y);
    const hit = boxes.some((o) => x0 < o.x + o.width && o.x < x1 + 1 && y0 < o.y + o.height && o.y < y1 + 1);
    if (hit) return false;
  }
  return true;
}

const centerX = (box: Box) => box.x + box.width / 2;
const top = (box: Box): Point => ({ x: centerX(box), y: box.y });
const bottom = (box: Box): Point => ({ x: centerX(box), y: box.y + box.height });
const right = (box: Box): Point => ({ x: box.x + box.width, y: box.y + box.height / 2 });

const distance = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);

function unit(a: Point, b: Point): Point {
  const length = distance(a, b) || 1;
  return { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
}

function toward(from: Point, to: Point, by: number): Point {
  const d = unit(from, to);
  return { x: from.x + d.x * by, y: from.y + d.y * by };
}
