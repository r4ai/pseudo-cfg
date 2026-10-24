export type Point = { x: number; y: number };
export type Box = { x: number; y: number; width: number; height: number };

export type EdgeGeometry = {
  /** Orthogonal polyline from the source anchor to the target anchor. */
  points: Point[];
  labelAt: Point;
};

export type EdgeTone = "yes" | "no" | "plain";

/** Whether an edge label means the condition held (`True`, `next`) or not (`False`, `done`). */
export function toneOf(label: string | null): EdgeTone {
  if (label === "True" || label === "next") return "yes";
  if (label === "False" || label === "done") return "no";
  return "plain";
}

const LANE_GAP = 20;
/** How far from a flat top's corners an off-center edge may enter. */
const FLAT_INSET = 16;
const LABEL_DISTANCE = 16;

/**
 * Routes an edge from the nodes' current boxes, so edges stay readable however
 * the user arranges the diagram. Anchors are side midpoints, which coincide with
 * diamond and hexagon vertices, so the same rules work for every shape.
 *
 * @param fromBranch - Branch nodes may leave through their side vertices.
 * @param obstacles - Other nodes; edges avoid running through them.
 * @param flatTarget - The target has a flat top, so an edge may enter it off-center to stay straight.
 */
export function routeEdge(
  source: Box,
  target: Box,
  fromBranch: boolean,
  obstacles: Box[],
  flatTarget = false,
): EdgeGeometry {
  const sourceX = centerX(source);
  const targetX = centerX(target);

  if (target.y >= source.y + source.height) {
    const spansSource = target.x <= sourceX && sourceX <= target.x + target.width;
    const straight = target.x + FLAT_INSET <= sourceX && sourceX <= target.x + target.width - FLAT_INSET;
    if (flatTarget && straight) return withLabel([bottom(source), { x: sourceX, y: target.y }]);
    if (!fromBranch || spansSource) return withLabel(dogleg(bottom(source), top(target), "vertical"));
    // Leave through the side vertex facing the target so True and False exits stay apart.
    const toRight = targetX > sourceX;
    const s = toRight ? right(source) : left(source);
    const t = top(target);
    const beyondSide = toRight ? t.x > s.x : t.x < s.x;
    const direct = [s, { x: t.x, y: s.y }, t];
    if (beyondSide && isClear(direct, obstacles)) return withLabel(direct);
    const lane = s.x + (toRight ? LANE_GAP : -LANE_GAP);
    const approach = Math.max(s.y, t.y - LANE_GAP);
    return withLabel([s, { x: lane, y: s.y }, { x: lane, y: approach }, { x: t.x, y: approach }, t]);
  }

  if (target.y + target.height <= source.y) {
    // Loop back edge: drop below the source, climb in a lane outside every node in between,
    // and come into the loop header from above, where it joins the edge entering the loop.
    // Entering from above keeps the header's side vertices free for its own exits.
    const useLeft = sourceX < targetX - source.width / 2;
    const s = bottom(source);
    const t = top(target);
    const below = s.y + LANE_GAP / 2;
    const above = t.y - LANE_GAP;
    const between = obstacles.filter((o) => o.y < below && o.y + o.height > above);
    const edges = [source, target, ...between];
    const lane = useLeft
      ? Math.min(...edges.map((o) => o.x)) - 2 * LANE_GAP
      : Math.max(...edges.map((o) => o.x + o.width)) + 2 * LANE_GAP;
    return withLabel([
      s,
      { x: s.x, y: below },
      { x: lane, y: below },
      { x: lane, y: above },
      { x: t.x, y: above },
      t,
    ]);
  }

  return targetX >= sourceX
    ? withLabel(dogleg(right(source), left(target), "horizontal"))
    : withLabel(dogleg(left(source), right(target), "horizontal"));
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
  const [s, next] = points as [Point, Point];
  const d = unit(s, next);
  return { points, labelAt: { x: s.x + d.x * LABEL_DISTANCE, y: s.y + d.y * LABEL_DISTANCE } };
}

/** SVG path for a polyline with rounded corners. */
export function roundedPath(points: Point[], radius = 8): string {
  const [first, ...rest] = points;
  if (!first) return "";
  let d = `M ${first.x} ${first.y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1] as Point;
    const corner = points[i] as Point;
    const next = points[i + 1] as Point;
    const r = Math.min(radius, distance(prev, corner) / 2, distance(corner, next) / 2);
    const a = toward(corner, prev, r);
    const b = toward(corner, next, r);
    d += ` L ${a.x} ${a.y} Q ${corner.x} ${corner.y} ${b.x} ${b.y}`;
  }
  const last = rest.at(-1);
  return last ? `${d} L ${last.x} ${last.y}` : d;
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
const left = (box: Box): Point => ({ x: box.x, y: box.y + box.height / 2 });
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
