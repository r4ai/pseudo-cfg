"use client";

import "@xyflow/react/dist/style.css";

import {
  Background,
  BackgroundVariant,
  Controls,
  type NodeChange,
  type OnNodesChange,
  Panel,
  ReactFlow,
  SelectionMode,
  useReactFlow,
} from "@xyflow/react";
import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react";
import type { Cfg, CfgNode as CfgNodeModel } from "@/features/cfg/build-cfg";
import type { Diagnostic } from "@/features/cfg/parse";
import { CfgEdge, type CfgFlowEdge } from "./cfg-edge";
import { CfgNode, type CfgFlowNode } from "./cfg-node";
import { nodeBoxes, routeEdges } from "./geometry";
import { nodeSize, type Positions } from "./layout";

const nodeTypes = { cfg: CfgNode };
/** Leaves room for the toolbar above and the zoom controls on the left. */
const FIT_VIEW_OPTIONS = {
  padding: { top: "72px", right: "32px", bottom: "32px", left: "64px" },
  maxZoom: 1,
} as const;
/** Arrow key presses closer together than this (ms) are undone together. */
const KEYBOARD_MOVE_GAP = 1000;
const edgeTypes = { cfg: CfgEdge };

type CfgCanvasProps = {
  cfg: Cfg;
  positions: Positions;
  /** Changes when the layout is replaced wholesale; the view then fits the new graph. */
  layoutEpoch: number;
  /** Nodes built from a line with a problem are marked. */
  diagnostics: Diagnostic[];
  /** Editor cursor line; nodes covering it are highlighted. */
  activeLine: number | null;
  onMove: (positions: Positions) => void;
  /** Called before a user-initiated layout change so it can be undone. */
  onCheckpoint: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onSelectNode: (node: CfgNodeModel | null) => void;
  onOpenNode: (node: CfgNodeModel) => void;
  /** Floating toolbar shown in the top-right corner. */
  children?: ReactNode;
};

/** Must be rendered inside a `ReactFlowProvider`. */
export function CfgCanvas({
  cfg,
  positions,
  layoutEpoch,
  diagnostics,
  activeLine,
  onMove,
  onCheckpoint,
  onUndo,
  onRedo,
  onSelectNode,
  onOpenNode,
  children,
}: CfgCanvasProps) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const { fitView } = useReactFlow();
  const fittedEpoch = useRef(layoutEpoch);

  useEffect(() => {
    if (fittedEpoch.current === layoutEpoch) return;
    fittedEpoch.current = layoutEpoch;
    // Wait a frame so React Flow has measured the new nodes.
    const frame = requestAnimationFrame(() => void fitView({ ...FIT_VIEW_OPTIONS, duration: 200 }));
    return () => cancelAnimationFrame(frame);
  }, [layoutEpoch, fitView]);

  const nodes: CfgFlowNode[] = cfg.nodes.map((node) => {
    // Start and end nodes stand for the whole scope, not the line they point at.
    const terminal = node.kind === "start" || node.kind === "end";
    return {
      id: node.id,
      type: "cfg",
      position: positions[node.id] ?? { x: 0, y: 0 },
      ...nodeSize(node),
      selected: selected.has(node.id),
      data: {
        node,
        active: !terminal && covers(node, activeLine),
        problems: terminal ? [] : diagnostics.filter((d) => covers(node, d.line)),
      },
    };
  });
  const edges: CfgFlowEdge[] = routeEdges(cfg, nodeBoxes(cfg, positions)).map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: "cfg",
    data: {
      label: edge.label,
      back: edge.back,
      geometry: edge.geometry,
      highlighted: selected.has(edge.source) || selected.has(edge.target),
    },
  }));
  const empty = cfg.nodes.every((node) => node.kind === "start" || node.kind === "end");

  const dragging = useRef(false);
  const lastKeyboardMove = useRef(0);

  const startDrag = () => {
    dragging.current = true;
    onCheckpoint();
  };
  const stopDrag = () => {
    dragging.current = false;
  };

  const onNodesChange: OnNodesChange<CfgFlowNode> = (changes) => {
    const moved = movedPositions(changes);
    if (Object.keys(moved).length > 0) {
      // Moves outside a drag come from the arrow keys; a burst of them is one undo step.
      if (!dragging.current) {
        if (Date.now() - lastKeyboardMove.current > KEYBOARD_MOVE_GAP) onCheckpoint();
        lastKeyboardMove.current = Date.now();
      }
      onMove(moved);
    }
    const nextSelected = applySelection(selected, changes);
    if (nextSelected === selected) return;
    setSelected(nextSelected);
    const only = nextSelected.size === 1 ? cfg.nodes.find((n) => nextSelected.has(n.id)) : undefined;
    onSelectNode(only ?? null);
  };

  const selectAll = () => {
    const all = new Set(cfg.nodes.map((n) => n.id));
    setSelected(all);
    onSelectNode(null);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const mod = event.metaKey || event.ctrlKey;
    if (event.key === "Enter" && !mod) {
      // Enter on a focused node jumps to its code, like a double-click.
      const id = (event.target as Element).closest(".react-flow__node")?.getAttribute("data-id");
      const node = cfg.nodes.find((n) => n.id === id);
      if (node) {
        onOpenNode(node);
        event.preventDefault();
      }
      return;
    }
    if (!mod) return;
    const key = event.key.toLowerCase();
    if ((key === "z" && event.shiftKey) || key === "y") onRedo();
    else if (key === "z") onUndo();
    else if (key === "a") selectAll();
    else return;
    event.preventDefault();
  };

  return (
    // Takes focus on click so canvas shortcuts don't fire while typing in the editor.
    // `application` is the ARIA role for widgets with their own keyboard model; jsx-a11y does not list it.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      role="application"
      aria-label="Control-flow graph canvas"
      className="cfg-canvas size-full outline-none"
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStart={startDrag}
        onNodeDragStop={stopDrag}
        onSelectionDragStart={startDrag}
        onSelectionDragStop={stopDrag}
        onNodeDoubleClick={(_, node) => onOpenNode(node.data.node)}
        colorMode="system"
        nodesConnectable={false}
        edgesFocusable={false}
        deleteKeyCode={null}
        selectionOnDrag
        selectionMode={SelectionMode.Partial}
        panOnDrag={[1, 2]}
        panOnScroll
        snapToGrid
        snapGrid={[4, 4]}
        fitView
        fitViewOptions={FIT_VIEW_OPTIONS}
        minZoom={0.1}
        onlyRenderVisibleElements
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
        <Controls showInteractive={false} position="bottom-left" fitViewOptions={FIT_VIEW_OPTIONS} />
        <Panel position="top-right">{children}</Panel>
        {empty && (
          <Panel
            position="top-center"
            className="pointer-events-none !top-1/3 text-center text-sm text-muted-foreground"
          >
            Type pseudocode on the left to see its control flow here.
          </Panel>
        )}
      </ReactFlow>
    </div>
  );
}

function covers(node: CfgNodeModel, line: number | null): boolean {
  return line !== null && node.line <= line && line <= node.endLine;
}

function movedPositions(changes: NodeChange<CfgFlowNode>[]): Positions {
  const moved: Positions = {};
  for (const change of changes) {
    if (change.type === "position" && change.position) moved[change.id] = change.position;
  }
  return moved;
}

function applySelection(
  current: ReadonlySet<string>,
  changes: NodeChange<CfgFlowNode>[],
): ReadonlySet<string> {
  const selects = changes.filter((c) => c.type === "select");
  if (selects.length === 0) return current;
  const next = new Set(current);
  for (const change of selects) {
    if (change.selected) next.add(change.id);
    else next.delete(change.id);
  }
  return next;
}
