"use client";

import { useEffect, useReducer } from "react";
import { isSavedWorkspace } from "./diagram-ops";
import { SAMPLE_SOURCE } from "./sample";
import { sharedSource, sharedSpec } from "./share";
import { compileYamlSpec } from "./spec";
import { initWorkspace, type SavedWorkspace, workspaceReducer } from "./workspace-state";

const STORAGE_KEY = "pseudo-cfg:workspace:v1";

const DEFAULT_WORKSPACE: SavedWorkspace = {
  source: SAMPLE_SOURCE,
  language: "python",
  granularity: "block",
  cfg: { nodes: [], edges: [] },
  positions: {},
  edges: {},
};

/** Workspace state, restored from and saved to localStorage. */
export function useWorkspace() {
  const [state, dispatch] = useReducer(workspaceReducer, undefined, () => initWorkspace(loadInitial()));

  useEffect(() => {
    // The shared code/spec is now the saved workspace; drop it from the address bar so a
    // reload shows later edits rather than the original link.
    if (sharedSpec(location.hash) !== null || sharedSource(location.hash) !== null)
      history.replaceState(null, "", location.pathname + location.search);
  }, []);

  useEffect(() => {
    const saved: SavedWorkspace = {
      source: state.source,
      language: state.language,
      granularity: state.granularity,
      cfg: state.cfg,
      positions: state.positions,
      edges: state.edges,
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    } catch {
      // Storage can be unavailable (private mode, quota); the app works without it.
    }
  }, [state.source, state.language, state.granularity, state.cfg, state.positions, state.edges]);

  return [state, dispatch] as const;
}

/** A shared `#spec=` YAML link or `#code=` link wins over the saved workspace. */
function loadInitial(): SavedWorkspace {
  const saved = loadSaved();
  const specYaml = sharedSpec(location.hash);
  if (specYaml !== null) {
    try {
      return compileYamlSpec(specYaml).workspace;
    } catch {
      // Corrupt spec link falls back to the saved workspace.
    }
  }
  const shared = sharedSource(location.hash);
  if (shared === null) return saved;
  return { ...saved, ...shared, cfg: { nodes: [], edges: [] }, positions: {}, edges: {} };
}

function loadSaved(): SavedWorkspace {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const value: unknown = raw ? JSON.parse(raw) : null;
    return isSavedWorkspace(value) ? value : DEFAULT_WORKSPACE;
  } catch {
    return DEFAULT_WORKSPACE;
  }
}
