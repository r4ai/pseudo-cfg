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

/** A side of a node; an edge attaches at its midpoint, which is a vertex of diamonds and hexagons. */
export type Side = "top" | "right" | "bottom" | "left";

/** Whether an edge label means the condition held (`True`, `next`) or not (`False`, `done`, `raise`). */
export function toneOf(label: string | null): EdgeTone {
  if (label === "True" || label === "next") return "yes";
  if (label === "False" || label === "done" || label === "raise") return "no";
  return "plain";
}

/** What an edge label shows: branch outcomes shrink to `T` and `F`, others stay as they are. */
export function shortLabel(label: string): string {
  if (label === "True") return "T";
  if (label === "False") return "F";
  return label;
}

const LANE_GAP = 20;
/** How far from a flat top's corners an off-center edge may enter. */
const FLAT_INSET = 16;
/** Gap between a label and the line it sits beside. */
const LABEL_GAP = 5;
export const LABEL_HEIGHT = 14;
/** Radius of the arc a line draws to hop over one it crosses; it shrinks to `MIN_HOP` near a corner. */
const HOP = 6;
const MIN_HOP = 3;
/** Radius of the rounded corners `roundedPath` draws. */
const CORNER = 8;

export type RouteOptions = {
  /** Which side the edge leaves from; see `exitSides` for how branch outcomes pick one. */
  exit?: "bottom" | "right" | "left";
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
  const { exit = "bottom", flatTarget = false, back = false, outer = false, lanes = [] } = options;
  if (exit === "left") {
    // Leaving on the left is leaving on the right in a mirror image.
    const [s, t] = [mirror(source), mirror(target)];
    const mirrored = obstacles.map((o) => (o === source ? s : o === target ? t : mirror(o)));
    const geometry = routeEdge(s, t, mirrored, { ...options, exit: "right", lanes: lanes.map(mirror) });
    return withLabel(geometry.points.map(({ x, y }) => ({ x: -x, y })));
  }
  const sourceX = centerX(source);
  const others = () => obstacles.filter((o) => o !== source && o !== target);
  const t = top(target);

  if (back || target.y + target.height <= source.y) {
    // Loop back edge: leave below the source (or by the False vertex), climb in a lane left of
    // every node in between, and come into the loop header from above, where it joins the edge
    // entering the loop. Entering from above keeps the header's side vertices free for its exits.
    const s = exit === "right" ? right(source) : bottom(source);
    // A False exit steps out to the right and drops below its node before turning left.
    const below = source.y + source.height + LANE_GAP / 2;
    const above = t.y - LANE_GAP;
    const between = obstacles.filter((o) => o.y < below && o.y + o.height > above);
    let lane = Math.min(...[source, target, ...between].map((o) => o.x)) - 2 * LANE_GAP;
    const taken = lanes.filter((o) => o.y < below && o.y + o.height > above);
    for (let hit = laneHit(lane, taken); hit; hit = laneHit(lane, taken)) lane = hit.x - LANE_GAP / 2;
    const turn = exit === "right" ? s.x + LANE_GAP / 2 : s.x;
    const start = exit === "right" ? [s, { x: turn, y: s.y }] : [s];
    return withLabel([
      ...start,
      { x: turn, y: below },
      { x: lane, y: below },
      { x: lane, y: above },
      { x: t.x, y: above },
      t,
    ]);
  }

  if (exit === "right") {
    // A side exit leaves to the right; a target further right is reached directly,
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

/** How far an edge runs straight out of (or into) a side before it may turn. */
const STUB = LANE_GAP;
/** What a bend costs, in pixels of length, when choosing between routes. */
const BEND = 40;

/**
 * Routes an edge between two given sides, for edges whose sides the user has chosen.
 * Of a few orthogonal shapes (L, Z, and lanes round everything in the way), the shortest
 * clear one wins, bends counting extra.
 */
export function routeBetween(source: Box, from: Side, target: Box, to: Side, obstacles: Box[]): EdgeGeometry {
  const s = anchor(source, from);
  const t = anchor(target, to);
  const s1 = outward(s, from, STUB);
  const t1 = outward(t, to, STUB);
  const blockers = [source, target, ...obstacles.filter((o) => o !== source && o !== target)];
  const spanY = blockers.filter((o) => o.y < Math.max(s1.y, t1.y) && o.y + o.height > Math.min(s1.y, t1.y));
  const spanX = blockers.filter((o) => o.x < Math.max(s1.x, t1.x) && o.x + o.width > Math.min(s1.x, t1.x));
  const lanesX = [
    (s1.x + t1.x) / 2,
    Math.min(s1.x, t1.x, ...spanY.map((o) => o.x)) - LANE_GAP,
    Math.max(s1.x, t1.x, ...spanY.map((o) => o.x + o.width)) + LANE_GAP,
  ];
  const lanesY = [
    (s1.y + t1.y) / 2,
    Math.min(s1.y, t1.y, ...spanX.map((o) => o.y)) - LANE_GAP,
    Math.max(s1.y, t1.y, ...spanX.map((o) => o.y + o.height)) + LANE_GAP,
  ];
  const middles = [
    [{ x: t1.x, y: s1.y }],
    [{ x: s1.x, y: t1.y }],
    ...lanesX.map((x) => [
      { x, y: s1.y },
      { x, y: t1.y },
    ]),
    ...lanesY.map((y) => [
      { x: s1.x, y },
      { x: t1.x, y },
    ]),
  ];
  const routes = middles
    .map((middle) => simplify([s, s1, ...middle, t1, t]))
    .filter((points) => leaves(points, from) && leaves(points.toReversed(), to));
  const clear = routes.filter((points) => isClear(points.slice(1, -1), blockers));
  const best = (clear.length > 0 ? clear : routes).toSorted((a, b) => routeCost(a) - routeCost(b))[0];
  return withLabel(best ?? [s, s1, t1, t]);
}

function routeCost(points: Point[]): number {
  return (
    points.slice(1).reduce((sum, p, i) => sum + distance(points[i] as Point, p), 0) + BEND * points.length
  );
}

/**
 * Moves the ends of a route the user shaped onto anchors that have moved with their nodes,
 * stretching the segments next to them so it stays orthogonal. Null when it no longer fits,
 * because an end would have to leave its node backwards.
 */
export function reanchor(points: Point[], s: Point, from: Side, t: Point, to: Side): Point[] | null {
  if (points.length < 3) return null;
  const p = points.map((point) => ({ ...point }));
  const n = p.length - 1;
  const first = sameX(p[0] as Point, p[1] as Point) ? "x" : "y";
  (p[1] as Point)[first] = s[first];
  p[0] = s;
  const last = sameX(p[n] as Point, p[n - 1] as Point) ? "x" : "y";
  (p[n - 1] as Point)[last] = t[last];
  p[n] = t;
  const route = simplify(p);
  return leaves(route, from) && leaves(route.toReversed(), to) ? route : null;
}

/**
 * The route with segment `index` slid sideways by `delta` (only the part across the segment
 * counts). A segment at an end first gets a short stub, so the end stays on its anchor.
 */
export function dragSegment(points: Point[], index: number, delta: Point): Point[] {
  let p = points.map((point) => ({ ...point }));
  let k = index;
  if (k === 0) {
    const a = toward(
      p[0] as Point,
      p[1] as Point,
      Math.min(STUB, distance(p[0] as Point, p[1] as Point) / 2),
    );
    p = [p[0] as Point, a, { ...a }, ...p.slice(1)];
    k = 2;
  }
  if (k === p.length - 2) {
    const n = p.length - 1;
    const b = toward(
      p[n] as Point,
      p[n - 1] as Point,
      Math.min(STUB, distance(p[n] as Point, p[n - 1] as Point) / 2),
    );
    p = [...p.slice(0, n), { ...b }, b, p[n] as Point];
  }
  const a = p[k] as Point;
  const b = p[k + 1] as Point;
  const axis = sameX(a, b) ? "x" : "y";
  a[axis] += delta[axis];
  b[axis] += delta[axis];
  return p;
}

/** Midpoint of a box's side. */
export function anchor(box: Box, side: Side): Point {
  switch (side) {
    case "top":
      return top(box);
    case "right":
      return right(box);
    case "bottom":
      return bottom(box);
    case "left":
      return { x: box.x, y: box.y + box.height / 2 };
  }
}

/** The side whose anchor is nearest to `point`. */
export function nearestSide(box: Box, point: Point): Side {
  const sides = ["top", "right", "bottom", "left"] as const;
  return sides.reduce((best, side) =>
    distance(anchor(box, side), point) < distance(anchor(box, best), point) ? side : best,
  );
}

const OUTWARD: Record<Side, Point> = {
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
};

const outward = (p: Point, side: Side, by: number): Point => ({
  x: p.x + OUTWARD[side].x * by,
  y: p.y + OUTWARD[side].y * by,
});

/** Whether the route's first segment heads out of `side` rather than back into the node. */
function leaves(points: Point[], side: Side): boolean {
  const [a, b] = points as [Point, Point];
  if (!b) return false;
  const d = unit(a, b);
  return d.x * OUTWARD[side].x + d.y * OUTWARD[side].y > 0.5;
}

/** Drops repeated points and points in the middle of a straight run. */
export function simplify(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out.at(-1);
    if (last && distance(last, p) < 0.5) continue;
    const before = out.at(-2);
    if (before && last && (sameX(before, last) ? sameX(last, p) : sameY(last, p))) {
      out[out.length - 1] = p;
      continue;
    }
    out.push(p);
  }
  return out;
}

const sameX = (a: Point, b: Point) => Math.abs(a.x - b.x) < 0.5;
const sameY = (a: Point, b: Point) => Math.abs(a.y - b.y) < 0.5;

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
  // Jumps keep well clear of the nodes they pass, leaving room for the exits' labels inside them.
  let x = outer ? Math.max(lane, ...inTheWay.map((o) => o.x + o.width + 2 * LANE_GAP)) : lane;
  // Step right past nodes (a full gap) and past lanes in use (half a gap) until clear.
  for (;;) {
    const node = laneHit(x, inTheWay, LANE_GAP / 2);
    const hit = node ?? laneHit(x, taken);
    if (!hit) break;
    x = hit.x + hit.width + (node ? LANE_GAP : LANE_GAP / 4);
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
    // A lane keeps half a gap clear on each side, so neighbouring lanes (and their hops) stay apart.
    boxes.push({
      x: a.x - LANE_GAP / 2,
      y: Math.min(a.y, b.y),
      width: LANE_GAP,
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
  return { points, labelAt: labelSpots(points, labelWidth("F"))[0] as Point, hops: [] };
}

/** Width of an edge label's shown text (see `shortLabel`), as drawn on the canvas and in exported images. */
export function labelWidth(label: string): number {
  return shortLabel(label).length * 7 + 2;
}

/**
 * Centers where a label of `width` may go, best first: tucked beside the start of the line
 * (right of a vertical start, above a horizontal one, else the other side), then slid along
 * the first segment, so it reads as belonging to that exit without covering the line.
 */
export function labelSpots(points: Point[], width: number): Point[] {
  const [s, next] = points as [Point, Point];
  const vertical = Math.abs(s.x - next.x) < 0.5;
  const dir = vertical ? Math.sign(next.y - s.y) : Math.sign(next.x - s.x);
  const length = distance(s, next);
  // Along the line the label takes its height (vertical start) or width (horizontal start).
  const size = vertical ? LABEL_HEIGHT : width;
  const beside = vertical ? LABEL_GAP + width / 2 : LABEL_HEIGHT / 2 + 1;
  const spots: Point[] = [];
  for (let at = 2; at === 2 || at + size <= length - LANE_GAP / 2; at += LABEL_HEIGHT / 2) {
    const along = at + size / 2;
    for (const side of [1, -1]) {
      spots.push(
        vertical
          ? { x: s.x + side * beside, y: s.y + dir * along }
          : { x: s.x + dir * (along + LABEL_GAP), y: s.y - side * beside },
      );
    }
  }
  return spots;
}

/** The first of `spots` whose label clears every box and every route, or else the first. */
export function clearSpot(spots: Point[], width: number, boxes: Box[], routes: Point[][]): Point {
  const clear = (at: Point) => {
    const label = {
      x: at.x - width / 2 - 1,
      y: at.y - LABEL_HEIGHT / 2,
      width: width + 2,
      height: LABEL_HEIGHT,
    };
    return boxes.every((o) => !overlap(label, o)) && routes.every((route) => isClear(route, [label]));
  };
  return spots.find(clear) ?? (spots[0] as Point);
}

const overlap = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
/** SVG path for a polyline with rounded corners, hopping over the lines it crosses at `hops`. */
export function roundedPath(points: Point[], radius = CORNER, hops: Point[] = []): string {
  const [first, ...rest] = points;
  if (!first) return "";
  let d = `M ${first.x} ${first.y}`;
  const lineTo = (from: Point, to: Point) => {
    if (Math.abs(from.y - to.y) < 0.5) {
      const dir = to.x > from.x ? 1 : -1;
      const on = hops
        .filter(
          (h) =>
            Math.abs(h.y - from.y) < 0.5 && (h.x - from.x) * dir > MIN_HOP && (to.x - h.x) * dir > MIN_HOP,
        )
        .map((h) => h.x)
        .toSorted((a, b) => (a - b) * dir);
      // Crossings too close for separate hops share one wider hop, so the line never doubles back.
      const spans: [number, number][] = [];
      for (const x of on) {
        const last = spans.at(-1);
        if (last && (x - last[1]) * dir < 2 * HOP + 4) last[1] = x;
        else spans.push([x, x]);
      }
      // Clockwise from the left end (or anticlockwise from the right) bulges upwards.
      let x = from.x;
      for (const [a, b] of spans) {
        // A hop near a corner or another hop gets lower and narrower so it still fits.
        const r = Math.min(HOP, (a - x) * dir - 1, (to.x - b) * dir - 1);
        const rx = r + Math.abs(b - a) / 2;
        d += ` L ${a - dir * r} ${from.y} A ${rx} ${r} 0 0 ${dir > 0 ? 1 : 0} ${b + dir * r} ${from.y}`;
        x = b + dir * r;
      }
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
  // The hop needs room on its own line clear of the corners; the crossed line only needs its
  // corner rounding clear.
  const along = CORNER + MIN_HOP + 1;
  const across = CORNER + 1;
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
              const crosses = x0 + along < c.x && c.x < x1 - along && y0 + across < a.y && a.y < y1 - across;
              return crosses ? [{ x: c.x, y: a.y }] : [];
            }),
      );
    }),
  );
}
/** Arrowhead triangle at the end of the polyline, plus the polyline trimmed to the arrow's base. */
export function arrowhead(points: Point[], length = 10, halfWidth = 5): { line: Point[]; head: string } {
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

/** The first box a vertical lane at `x` runs through or passes closer than `clearance` to. */
const laneHit = (x: number, boxes: Box[], clearance = 0) =>
  boxes.find((o) => o.x - clearance <= x && x <= o.x + o.width + clearance);

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

const mirror = (box: Box): Box => ({ ...box, x: -box.x - box.width });

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
