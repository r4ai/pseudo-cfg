"use client";

import { ReactFlowProvider } from "@xyflow/react";
import { useRef, useState } from "react";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { CfgCanvas } from "@/features/diagram/cfg-canvas";
import { DiagramToolbar } from "@/features/diagram/diagram-toolbar";
import { CodeEditor, type CodeEditorHandle } from "@/features/editor/code-editor";
import { useWorkspace } from "./use-workspace";

/** Editor on the left, live control-flow graph on the right. */
export function Workspace() {
  const [state, dispatch] = useWorkspace();
  const [cursorLine, setCursorLine] = useState<number | null>(null);
  const editor = useRef<CodeEditorHandle>(null);

  return (
    <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
      <ResizablePanel defaultSize="40%" minSize="20%">
        <section aria-label="Pseudocode editor" className="h-full">
          <CodeEditor
            ref={editor}
            defaultValue={state.source}
            diagnostics={state.diagnostics}
            onChange={(source) => dispatch({ type: "edit", source })}
            onCursorLineChange={setCursorLine}
          />
        </section>
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel minSize="25%">
        <section aria-label="Control-flow graph" className="h-full">
          <ReactFlowProvider>
            <CfgCanvas
              cfg={state.cfg}
              positions={state.positions}
              layoutEpoch={state.layoutEpoch}
              activeLine={cursorLine}
              onMove={(positions) => dispatch({ type: "move", positions })}
              onCheckpoint={() => dispatch({ type: "checkpoint" })}
              onUndo={() => dispatch({ type: "undo" })}
              onRedo={() => dispatch({ type: "redo" })}
              onSelectNode={(node) => editor.current?.reveal(node)}
              onOpenNode={(node) => editor.current?.focusLine(node.line)}
            >
              <DiagramToolbar
                cfg={state.cfg}
                positions={state.positions}
                granularity={state.granularity}
                onGranularityChange={(granularity) => dispatch({ type: "setGranularity", granularity })}
                onTidy={() => dispatch({ type: "tidy" })}
              />
            </CfgCanvas>
          </ReactFlowProvider>
        </section>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
