"use client";

import { useEffect, useReducer } from "react";
import type { Granularity } from "@/features/cfg/build-cfg";
import { SAMPLE_SOURCE } from "./sample";
import { initWorkspace, type SavedWorkspace, workspaceReducer } from "./workspace-state";

const STORAGE_KEY = "pseudo-cfg:workspace:v1";

const DEFAULT_WORKSPACE: SavedWorkspace = {
  source: SAMPLE_SOURCE,
  granularity: "block",
  cfg: { nodes: [], edges: [] },
  positions: {},
};

/** Workspace state, restored from and saved to localStorage. */
export function useWorkspace() {
  const [state, dispatch] = useReducer(workspaceReducer, undefined, () => initWorkspace(loadSaved()));

  useEffect(() => {
    const saved: SavedWorkspace = {
      source: state.source,
      granularity: state.granularity,
      cfg: state.cfg,
      positions: state.positions,
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    } catch {
      // Storage can be unavailable (private mode, quota); the app works without it.
    }
  }, [state.source, state.granularity, state.cfg, state.positions]);

  return [state, dispatch] as const;
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

const GRANULARITIES: ReadonlySet<string> = new Set<Granularity>(["block", "statement"]);

function isSavedWorkspace(value: unknown): value is SavedWorkspace {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  const cfg = v.cfg as Record<string, unknown> | undefined;
  return (
    typeof v.source === "string" &&
    typeof v.granularity === "string" &&
    GRANULARITIES.has(v.granularity) &&
    typeof v.positions === "object" &&
    v.positions !== null &&
    Array.isArray(cfg?.nodes) &&
    Array.isArray(cfg?.edges)
  );
}
