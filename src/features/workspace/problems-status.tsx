"use client";

import { CircleAlertIcon, CircleCheckIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { Diagnostic } from "@/features/cfg/parse";

type ProblemsStatusProps = {
  diagnostics: Diagnostic[];
  onSelect: (diagnostic: Diagnostic) => void;
};

/** Problem count for the status bar; opens a list that jumps to each problem's line. */
export function ProblemsStatus({ diagnostics, onSelect }: ProblemsStatusProps) {
  if (diagnostics.length === 0) {
    return (
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <CircleCheckIcon className="size-3.5" aria-hidden="true" />
        No problems
      </span>
    );
  }
  const count = `${diagnostics.length} ${diagnostics.length === 1 ? "problem" : "problems"}`;
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button variant="ghost" size="xs" className="-mx-2 text-destructive hover:text-destructive" />
        }
      >
        <CircleAlertIcon aria-hidden="true" />
        {count}
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-80 gap-1 p-1">
        <p className="px-2 pt-1 pb-0.5 text-xs font-medium text-muted-foreground">{count}</p>
        <ul className="flex max-h-64 flex-col overflow-auto">
          {diagnostics.map((diagnostic) => (
            <li key={`${diagnostic.line}:${diagnostic.message}`}>
              <button
                type="button"
                className="flex w-full items-baseline gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                onClick={() => onSelect(diagnostic)}
              >
                <CircleAlertIcon
                  className="size-3.5 shrink-0 translate-y-0.5 text-destructive"
                  aria-hidden="true"
                />
                <span className="flex-1">{diagnostic.message}</span>
                <span className="shrink-0 font-mono text-xs text-muted-foreground">Ln {diagnostic.line}</span>
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
