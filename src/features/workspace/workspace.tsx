"use client";

import { ReactFlowProvider } from "@xyflow/react";
import { BookOpenIcon, ChevronDownIcon, LinkIcon } from "lucide-react";
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
import { toast } from "@/components/ui/toast";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Language } from "@/features/cfg/build-cfg";
import { CfgCanvas } from "@/features/diagram/cfg-canvas";
import { DiagramToolbar } from "@/features/diagram/diagram-toolbar";
import { CodeEditor, type CodeEditorHandle } from "@/features/editor/code-editor";
import { ProblemsStatus } from "./problems-status";
import { EXAMPLES, sampleFor } from "./sample";
import { shareUrl } from "./share";
import { useMediaQuery } from "./use-media-query";
import { useWorkspace } from "./use-workspace";

const REPOSITORY_URL = "https://github.com/r4ai/pseudo-cfg";

const LANGUAGES: { value: Language; name: string; description: string }[] = [
  { value: "python", name: "Python", description: "Indentation-based, like Python" },
  { value: "cuda", name: "CUDA", description: "Brace-delimited, like CUDA C++" },
];

/** Lucide dropped brand icons, so the GitHub mark is inlined. */
function GitHubIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2.2c-3.3.7-4-1.4-4-1.4-.6-1.4-1.4-1.8-1.4-1.8-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 0-.8.4-1.3.7-1.6-2.7-.3-5.5-1.3-5.5-6 0-1.2.5-2.3 1.3-3.1-.2-.4-.6-1.6 0-3.2 0 0 1-.3 3.4 1.2a11.5 11.5 0 0 1 6 0c2.3-1.5 3.3-1.2 3.3-1.2.6 1.6.2 2.8.1 3.2.8.8 1.3 1.9 1.3 3.2 0 4.6-2.8 5.6-5.5 5.9.5.4.9 1.1.9 2.3v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .3" />
    </svg>
  );
}

/** Editor on the left (or on top on narrow screens), live control-flow graph beside it. */
export function Workspace() {
  const [state, dispatch] = useWorkspace();
  const [cursorLine, setCursorLine] = useState<number | null>(null);
  const editor = useRef<CodeEditorHandle>(null);
  const narrow = useMediaQuery("(max-width: 767px)");
  const orientation = narrow ? "vertical" : "horizontal";

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(
        shareUrl({ source: state.source, language: state.language }, location.href),
      );
      toast.add({
        title: "Link copied",
        description: "Anyone with the link sees this code.",
        type: "success",
      });
    } catch (error) {
      const description = error instanceof Error ? error.message : String(error);
      toast.add({ title: "Could not copy the link", description, type: "error" });
    }
  };

  const switchLanguage = (language: Language, source: string) => {
    dispatch({ type: "setLanguage", language, source });
    if (source !== state.source) editor.current?.setValue(source);
  };

  return (
    <ResizablePanelGroup orientation={orientation} className="min-h-0 flex-1">
      <ResizablePanel defaultSize={narrow ? "45%" : "40%"} minSize="20%">
        <section aria-label="Pseudocode editor" className="flex h-full flex-col">
          <div className="flex h-9 shrink-0 items-center gap-1 border-b pr-1.5 pl-3">
            <h2 className="text-xs font-medium text-muted-foreground">Pseudocode</h2>
            <ToggleGroup
              size="sm"
              className="mr-auto ml-1"
              value={[state.language]}
              onValueChange={(value) => {
                const next = value[0] as Language | undefined;
                if (!next) return;
                // An untouched example is swapped for one in the new language; edited code is kept.
                const untouched = EXAMPLES.some((example) => example.source === state.source);
                switchLanguage(next, untouched ? sampleFor(next).source : state.source);
              }}
              aria-label="Pseudocode syntax"
            >
              {LANGUAGES.map((language) => (
                <Tooltip key={language.value}>
                  <TooltipTrigger render={<ToggleGroupItem value={language.value} />}>
                    {language.name}
                  </TooltipTrigger>
                  <TooltipContent>{language.description}</TooltipContent>
                </Tooltip>
              ))}
            </ToggleGroup>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    nativeButton={false}
                    render={
                      <a
                        href={REPOSITORY_URL}
                        target="_blank"
                        rel="noreferrer"
                        aria-label="Source code on GitHub"
                      />
                    }
                  />
                }
              >
                <GitHubIcon />
              </TooltipTrigger>
              <TooltipContent>Source code on GitHub</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Copy link to this code"
                    onClick={copyLink}
                  />
                }
              >
                <LinkIcon />
              </TooltipTrigger>
              <TooltipContent>Copy a link that opens this code</TooltipContent>
            </Tooltip>
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="ghost" size="xs" />}>
                <BookOpenIcon data-icon="inline-start" />
                Examples
                <ChevronDownIcon data-icon="inline-end" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                {LANGUAGES.map((language) => (
                  <DropdownMenuGroup key={language.value}>
                    <DropdownMenuLabel>{language.name}</DropdownMenuLabel>
                    {EXAMPLES.filter((example) => example.language === language.value).map((example) => (
                      <DropdownMenuItem
                        key={example.name}
                        onClick={() => switchLanguage(example.language, example.source)}
                      >
                        {example.name}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuGroup>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <CodeEditor
            ref={editor}
            defaultValue={state.source}
            language={state.language}
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
      <ResizableHandle withHandle />
      <ResizablePanel minSize="25%">
        <section aria-label="Control-flow graph" className="h-full">
          <ReactFlowProvider>
            <CfgCanvas
              cfg={state.cfg}
              positions={state.positions}
              edgeOverrides={state.edges}
              layoutEpoch={state.layoutEpoch}
              diagnostics={state.diagnostics}
              activeLine={cursorLine}
              onMove={(positions) => dispatch({ type: "move", positions })}
              onShapeEdge={(key, override) => dispatch({ type: "shapeEdge", key, override })}
              onCheckpoint={() => dispatch({ type: "checkpoint" })}
              onUndo={() => dispatch({ type: "undo" })}
              onRedo={() => dispatch({ type: "redo" })}
              onSelectNode={(node) => editor.current?.reveal(node)}
              onOpenNode={(node) => editor.current?.focusLine(node.line)}
            >
              <DiagramToolbar
                cfg={state.cfg}
                positions={state.positions}
                edgeOverrides={state.edges}
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
