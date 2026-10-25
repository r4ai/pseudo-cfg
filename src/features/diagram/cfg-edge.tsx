"use client";

import { BaseEdge, type Edge, EdgeLabelRenderer, type EdgeProps } from "@xyflow/react";
import { cn } from "@/lib/utils";
import { arrowhead, type EdgeGeometry, roundedPath, shortLabel, toneOf } from "./edge-route";

export type CfgEdgeData = {
  label: string | null;
  back: boolean;
  geometry: EdgeGeometry;
  /** Touches a selected node. */
  highlighted: boolean;
};
export type CfgFlowEdge = Edge<CfgEdgeData, "cfg">;

/**
 * Draws a precomputed route; see `routeEdge`. The arrowhead is plain SVG so it survives image export.
 * Loop back edges are dashed, and branch labels are tinted by outcome.
 */
export function CfgEdge({ data }: EdgeProps<CfgFlowEdge>) {
  if (!data) return null;
  const { line, head } = arrowhead(data.geometry.points);
  const { labelAt } = data.geometry;
  const tone = toneOf(data.label);
  return (
    <>
      <BaseEdge
        path={roundedPath(line, 8, data.geometry.hops)}
        className={cn("cfg-edge", data.back && "is-back", data.highlighted && "is-highlighted")}
      />
      <polygon className={cn("cfg-arrowhead", data.highlighted && "is-highlighted")} points={head} />
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
