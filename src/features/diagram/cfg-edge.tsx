"use client";

import {
  BaseEdge,
  type Edge,
  EdgeLabelRenderer,
  type EdgeProps,
  useReactFlow,
  useStore,
} from "@xyflow/react";
import { createContext, type PointerEvent, use } from "react";
import { cn } from "@/lib/utils";
import {
  arrowhead,
  type Box,
  dragSegment,
  type EdgeGeometry,
  nearestSide,
  type Point,
  roundedPath,
  shortLabel,
  type Side,
  simplify,
  toneOf,
} from "./edge-route";
import type { EdgeOverride, EdgeOverrides } from "./geometry";

export type CfgEdgeData = {
  label: string | null;
  back: boolean;
  geometry: EdgeGeometry;
  /** See `edgeKey`. */
  key: string;
  sourceSide: Side;
  targetSide: Side;
  /** Touches a selected node. */
  highlighted: boolean;
};
export type CfgFlowEdge = Edge<CfgEdgeData, "cfg">;

/** What a selected edge needs to be reshaped by dragging its handles. */
export type EdgeEditing = {
  boxes: Map<string, Box>;
  overrides: EdgeOverrides;
  /** Called once a drag first changes the edge, so the change can be undone. */
  onCheckpoint: () => void;
  onShape: (key: string, override: EdgeOverride) => void;
};

export const EdgeEditingContext = createContext<EdgeEditing | null>(null);

/** Drags shorter than this many pixels snap to it, matching the node grid. */
const SNAP = 4;
/** Segments shorter than this get no handle; there is no room to grab them. */
const MIN_HANDLE_SEGMENT = 24;

/**
 * Draws a precomputed route; see `routeEdge`. The arrowhead is plain SVG so it survives image export.
 * Loop back edges are dashed, and branch labels are tinted by outcome.
 *
 * A selected edge shows handles: drag an end to attach it to another side of its node, or a
 * segment to move it sideways.
 */
export function CfgEdge({ source, target, selected, data }: EdgeProps<CfgFlowEdge>) {
  const editing = use(EdgeEditingContext);
  const { screenToFlowPosition } = useReactFlow();
  // Handles keep the same size on screen at any zoom, so they stay easy to grab.
  const unit = 1 / useStore((state) => state.transform[2]);
  if (!data) return null;
  const { points } = data.geometry;
  const { line, head } = arrowhead(points);
  const { labelAt } = data.geometry;
  const tone = toneOf(data.label);
  const highlighted = data.highlighted || selected;

  const toFlow = (e: { clientX: number; clientY: number }) =>
    screenToFlowPosition({ x: e.clientX, y: e.clientY });

  /** Follows the pointer from `event` until it is released, reporting where it is in the flow. */
  const drag = (event: PointerEvent<SVGElement>, onMove: (at: Point, from: Point) => void) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const from = toFlow(event);
    const move = (e: globalThis.PointerEvent) => onMove(toFlow(e), from);
    const stop = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", stop);
      handle.removeEventListener("pointercancel", stop);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", stop);
    handle.addEventListener("pointercancel", stop);
  };

  const dragEnd = (event: PointerEvent<SVGElement>, end: "source" | "target") => {
    const box = editing?.boxes.get(end === "source" ? source : target);
    if (!editing || !box) return;
    // A drawn route can't follow an end to another side, so the edge is routed again.
    const { points: _, ...base } = editing.overrides[data.key] ?? {};
    let side = end === "source" ? data.sourceSide : data.targetSide;
    let changed = false;
    drag(event, (at) => {
      const next = nearestSide(box, at);
      if (next === side) return;
      if (!changed) editing.onCheckpoint();
      changed = true;
      side = next;
      editing.onShape(data.key, { ...base, [end]: side });
    });
  };

  const dragSegmentAt = (event: PointerEvent<SVGElement>, index: number) => {
    if (!editing) return;
    let changed = false;
    drag(event, (at, from) => {
      const delta = { x: snap(at.x - from.x), y: snap(at.y - from.y) };
      if (!changed && delta.x === 0 && delta.y === 0) return;
      if (!changed) editing.onCheckpoint();
      changed = true;
      const drawn = simplify(dragSegment(points, index, delta));
      editing.onShape(data.key, { source: data.sourceSide, target: data.targetSide, points: drawn });
    });
  };

  const segments = points.slice(1).flatMap((b, index) => {
    const a = points[index] as Point;
    const vertical = Math.abs(a.x - b.x) < 0.5;
    const length = Math.abs(vertical ? b.y - a.y : b.x - a.x);
    if (length < MIN_HANDLE_SEGMENT) return [];
    return [{ index, vertical, at: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } }];
  });
  const ends = [
    { end: "source", at: points[0] as Point },
    { end: "target", at: points.at(-1) as Point },
  ] as const;

  return (
    <>
      <BaseEdge
        path={roundedPath(line, 8, data.geometry.hops)}
        className={cn("cfg-edge", data.back && "is-back", highlighted && "is-highlighted")}
      />
      <polygon className={cn("cfg-arrowhead", highlighted && "is-highlighted")} points={head} />
      {selected &&
        editing &&
        segments.map(({ index, vertical, at }) => (
          <rect
            key={`segment-${index}`}
            className={cn("cfg-edge-handle nodrag nopan", vertical ? "cursor-ew-resize" : "cursor-ns-resize")}
            x={at.x - (vertical ? 4 : 10) * unit}
            y={at.y - (vertical ? 10 : 4) * unit}
            width={(vertical ? 8 : 20) * unit}
            height={(vertical ? 20 : 8) * unit}
            rx={4 * unit}
            strokeWidth={1.5 * unit}
            onPointerDown={(event) => dragSegmentAt(event, index)}
          />
        ))}
      {selected &&
        editing &&
        ends.map(({ end, at }) => (
          <circle
            key={end}
            className="cfg-edge-handle nodrag nopan cursor-move"
            cx={at.x}
            cy={at.y}
            r={6 * unit}
            strokeWidth={1.5 * unit}
            onPointerDown={(event) => dragEnd(event, end)}
          />
        ))}
      {data.label && (
        <EdgeLabelRenderer>
          <span
            className={cn("cfg-edge-label nodrag nopan", `is-${tone}`)}
            style={{ transform: `translate(-50%, -50%) translate(${labelAt.x}px, ${labelAt.y}px)` }}
          >
            {shortLabel(data.label)}
          </span>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const snap = (value: number) => Math.round(value / SNAP) * SNAP;
