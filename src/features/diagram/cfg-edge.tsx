"use client";

import { BaseEdge, type Edge, type EdgeProps } from "@xyflow/react";
import { arrowhead, type EdgeGeometry, roundedPath } from "./edge-route";

export type CfgEdgeData = { label: string | null; geometry: EdgeGeometry };
export type CfgFlowEdge = Edge<CfgEdgeData, "cfg">;

/** Draws a precomputed route; see `routeEdge`. The arrowhead is plain SVG so it survives image export. */
export function CfgEdge({ data }: EdgeProps<CfgFlowEdge>) {
  if (!data) return null;
  const { line, head } = arrowhead(data.geometry.points);
  const { labelAt } = data.geometry;
  return (
    <>
      <BaseEdge
        path={roundedPath(line)}
        className="cfg-edge"
        {...(data.label ? { label: data.label } : {})}
        labelX={labelAt.x}
        labelY={labelAt.y}
        labelShowBg
        labelBgPadding={[4, 2]}
        labelBgBorderRadius={4}
        labelStyle={{ fill: "var(--muted-foreground)", fontSize: 11 }}
        labelBgStyle={{ fill: "var(--background)" }}
      />
      <polygon className="cfg-arrowhead" points={head} />
    </>
  );
}
