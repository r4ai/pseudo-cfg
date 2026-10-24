"use client";

import { ReactFlowProvider } from "@xyflow/react";
import { BookOpenIcon, ChevronDownIcon } from "lucide-react";
import { startTransition, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { CfgCanvas } from "@/features/diagram/cfg-canvas";
import { DiagramToolbar } from "@/features/diagram/diagram-toolbar";
import { CodeEditor, type CodeEditorHandle } from "@/features/editor/code-editor";
import { ProblemsStatus } from "./problems-status";
import { EXAMPLES } from "./sample";
import { useMediaQuery } from "./use-media-query";
import { useWorkspace } from "./use-workspace";

/** Editor on the left (or on top on narrow screens), live control-flow graph beside it. */
export function Workspace() {
  const [state, dispatch] = useWorkspace();
  const [cursorLine, setCursorLine] = useState<number | null>(null);
  const editor = useRef<CodeEditorHandle>(null);
  const narrow = useMediaQuery("(max-width: 767px)");
  const orientation = narrow ? "vertical" : "horizontal";

  return (
    <ResizablePanelGroup key={orientation} orientation={orientation} className="min-h-0 flex-1">
      <ResizablePanel defaultSize={narrow ? "45%" : "40%"} minSize="20%">
        <section aria-label="Pseudocode editor" className="flex h-full flex-col">
          <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b pr-1.5 pl-3">
            <h2 className="text-xs font-medium text-muted-foreground">Pseudocode</h2>
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="ghost" size="xs" />}>
                <BookOpenIcon data-icon="inline-start" />
                Examples
                <ChevronDownIcon data-icon="inline-end" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Replace the code with an example</DropdownMenuLabel>
                  {EXAMPLES.map((example) => (
                    <DropdownMenuItem
                      key={example.name}
                      onClick={() => editor.current?.setValue(example.source)}
                    >
                      {example.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <CodeEditor
            ref={editor}
            defaultValue={state.source}
            diagnostics={state.diagnostics}
            // The editor owns its text, so the graph can catch up without delaying keystrokes.
            onChange={(source) => startTransition(() => dispatch({ type: "edit", source }))}
            onCursorLineChange={setCursorLine}
          />
          <footer className="flex h-7 shrink-0 items-center justify-between gap-3 border-t px-3 text-xs">
            <ProblemsStatus
              diagnostics={state.diagnostics}
              onSelect={(diagnostic) => editor.current?.focusLine(diagnostic.line)}
            />
            <span className="text-muted-foreground tabular-nums">
              {cursorLine === null ? "" : `Ln ${cursorLine}`}
            </span>
          </footer>
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
              diagnostics={state.diagnostics}
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
