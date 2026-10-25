"use client";

import { CircleHelpIcon, CopyIcon, DownloadIcon, WandSparklesIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "@/components/ui/toast";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Cfg, Granularity } from "@/features/cfg/build-cfg";
import { copyPng, diagramToSvg, downloadBlob, svgToPng } from "./export-image";
import type { EdgeOverrides } from "./geometry";
import type { Positions } from "./layout";

type DiagramToolbarProps = {
  cfg: Cfg;
  positions: Positions;
  edgeOverrides: EdgeOverrides;
  granularity: Granularity;
  onGranularityChange: (granularity: Granularity) => void;
  onTidy: () => void;
};

const FILE_NAME = "control-flow-graph";

/** Runs an export and reports the outcome in a toast. */
async function run(action: () => Promise<void>, success: string) {
  try {
    await action();
    toast.add({ title: success, type: "success" });
  } catch (error) {
    const description = error instanceof Error ? error.message : String(error);
    toast.add({ title: "Could not export the image", description, type: "error" });
  }
}

export function DiagramToolbar({
  cfg,
  positions,
  edgeOverrides,
  granularity,
  onGranularityChange,
  onTidy,
}: DiagramToolbarProps) {
  const svg = () => diagramToSvg(cfg, positions, edgeOverrides);

  const copyImage = () => run(() => copyPng(svgToPng(svg())), "Image copied to clipboard");
  const savePng = () => run(async () => downloadBlob(await svgToPng(svg()), `${FILE_NAME}.png`), "Saved PNG");
  const saveSvg = () =>
    run(
      async () => downloadBlob(new Blob([svg()], { type: "image/svg+xml" }), `${FILE_NAME}.svg`),
      "Saved SVG",
    );

  return (
    <div className="flex min-w-0 items-center gap-1">
      <ToggleGroup
        size="sm"
        value={[granularity]}
        onValueChange={(value) => {
          const next = value[0] as Granularity | undefined;
          if (next) onGranularityChange(next);
        }}
        aria-label="Node granularity"
      >
        <Tooltip>
          <TooltipTrigger render={<ToggleGroupItem value="block" />}>Blocks</TooltipTrigger>
          <TooltipContent>One node per basic block</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger render={<ToggleGroupItem value="statement" />}>Statements</TooltipTrigger>
          <TooltipContent>One node per statement</TooltipContent>
        </Tooltip>
      </ToggleGroup>
      <Tooltip>
        <TooltipTrigger render={<Button variant="ghost" size="sm" onClick={onTidy} />}>
          <WandSparklesIcon data-icon="inline-start" />
          <span className="max-sm:sr-only">Tidy up</span>
        </TooltipTrigger>
        <TooltipContent>Discard manual positions and edge routes and lay out again</TooltipContent>
      </Tooltip>
      <Button size="sm" onClick={copyImage}>
        <CopyIcon data-icon="inline-start" />
        <span className="max-sm:sr-only">Copy image</span>
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Download image" />}>
          <DownloadIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={savePng}>Download PNG</DropdownMenuItem>
            <DropdownMenuItem onClick={saveSvg}>Download SVG</DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <Popover>
        <PopoverTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Diagram controls" />}>
          <CircleHelpIcon />
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 gap-1">
          <p className="font-medium">Diagram controls</p>
          <dl className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5 text-xs">
            {CONTROLS.map(([keys, action]) => (
              <div key={keys.join("+")} className="contents">
                <dt className="flex gap-1">
                  {keys.map((key) => (
                    <Kbd key={key}>{key}</Kbd>
                  ))}
                </dt>
                <dd className="text-muted-foreground">{action}</dd>
              </div>
            ))}
          </dl>
        </PopoverContent>
      </Popover>
    </div>
  );
}

const CONTROLS: [keys: string[], action: string][] = [
  [["Drag node"], "Move it; the position is kept while you edit"],
  [["Drag"], "Select an area"],
  [["Scroll"], "Pan"],
  [["Space", "Drag"], "Pan"],
  [["⌘/Ctrl", "Scroll"], "Zoom"],
  [["Click"], "Highlight the node's source lines"],
  [["Double-click"], "Jump to the node's code"],
  [["Tab", "Enter"], "Focus a node, then jump to its code"],
  [["↑↓←→"], "Nudge the focused node"],
  [["⌘/Ctrl", "Z"], "Undo a layout change"],
  [["⌘/Ctrl", "⇧", "Z"], "Redo"],
  [["⌘/Ctrl", "A"], "Select all nodes"],
];
