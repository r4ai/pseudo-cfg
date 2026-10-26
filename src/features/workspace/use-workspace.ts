"use client";

import { useEffect, useReducer } from "react";
import { saveOpenWorkspace } from "./use-files";
import { initWorkspace, type SavedWorkspace, workspaceReducer } from "./workspace-state";

/** Workspace state, started from `saved` and saved into the open file whenever it changes. */
export function useWorkspace(saved: SavedWorkspace) {
  const [state, dispatch] = useReducer(workspaceReducer, saved, initWorkspace);

  useEffect(() => {
    saveOpenWorkspace({
      source: state.source,
      language: state.language,
      granularity: state.granularity,
      cfg: state.cfg,
      positions: state.positions,
      edges: state.edges,
    });
  }, [state.source, state.language, state.granularity, state.cfg, state.positions, state.edges]);

  return [state, dispatch] as const;
}
