"use client";

import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";
import type { CfgNode as CfgNodeModel } from "@/features/cfg/build-cfg";
import { cn } from "@/lib/utils";
import { shapeOf } from "./shapes";

export type CfgNodeData = { node: CfgNodeModel; active: boolean };
export type CfgFlowNode = Node<CfgNodeData, "cfg">;

/** Renders a node shape sized by `nodeSize`; edges attach through the hidden center handles. */
export function CfgNode({ data, width = 0, height = 0, selected }: NodeProps<CfgFlowNode>) {
  const { node, active } = data;
  const shape = shapeOf(node.kind, width, height);
  const className = cn("cfg-shape", `cfg-shape-${node.kind}`);
  return (
    <div
      className={cn("relative grid place-items-center", active && "is-active", selected && "is-selected")}
      style={{ width, height }}
    >
      <svg className="absolute inset-0 overflow-visible" width={width} height={height} aria-hidden="true">
        {shape.type === "rect" ? (
          <rect className={className} width={width} height={height} rx={shape.rx} />
        ) : (
          <polygon className={className} points={shape.points} />
        )}
      </svg>
      <span className="relative whitespace-pre px-3.5 text-center font-mono text-[13px] leading-5 text-foreground">
        {node.label}
      </span>
      <Handle type="target" position={Position.Top} className="cfg-handle" isConnectable={false} />
      <Handle type="source" position={Position.Bottom} className="cfg-handle" isConnectable={false} />
    </div>
  );
}
