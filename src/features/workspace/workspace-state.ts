import { buildCfg, type Cfg, type Granularity } from "@/features/cfg/build-cfg";
import type { Diagnostic } from "@/features/cfg/parse";
import { reconcile } from "@/features/cfg/reconcile";
import { autoLayout, placeIncrementally, type Positions } from "@/features/diagram/layout";

export type WorkspaceState = {
  source: string;
  granularity: Granularity;
  cfg: Cfg;
  diagnostics: Diagnostic[];
  positions: Positions;
  /** Layout history for undo/redo in the diagram; the editor keeps its own text history. */
  undo: Positions[];
  redo: Positions[];
};

/** What is persisted between visits. Ids in `cfg` let saved positions survive a reload. */
export type SavedWorkspace = Pick<WorkspaceState, "source" | "granularity" | "cfg" | "positions">;

export type WorkspaceAction =
  | { type: "edit"; source: string }
  | { type: "setGranularity"; granularity: Granularity }
  | { type: "move"; positions: Positions }
  | { type: "checkpoint" }
  | { type: "tidy" }
  | { type: "undo" }
  | { type: "redo" };

const HISTORY_LIMIT = 100;

const createId = () => crypto.randomUUID().slice(0, 8);

export function initWorkspace(saved: SavedWorkspace): WorkspaceState {
  return rebuild({ ...saved, diagnostics: [], undo: [], redo: [] }, saved.source, saved.granularity);
}

export function workspaceReducer(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
  switch (action.type) {
    case "edit":
      return rebuild(state, action.source, state.granularity);
    case "setGranularity": {
      // The node structure changes wholesale, so a fresh layout reads better than an incremental one.
      const next = rebuild(withCheckpoint(state), state.source, action.granularity);
      return { ...next, positions: autoLayout(next.cfg) };
    }
    case "move":
      return { ...state, positions: { ...state.positions, ...action.positions } };
    case "checkpoint":
      return withCheckpoint(state);
    case "tidy":
      return { ...withCheckpoint(state), positions: autoLayout(state.cfg) };
    case "undo":
      return travel(state, "undo", "redo");
    case "redo":
      return travel(state, "redo", "undo");
  }
}

/** Rebuilds the graph from source while keeping ids and positions of unchanged nodes. */
function rebuild(state: WorkspaceState, source: string, granularity: Granularity): WorkspaceState {
  const built = buildCfg(source, granularity);
  const cfg = reconcile(state.cfg, built.cfg, createId);
  const positions = placeIncrementally(state.cfg, state.positions, cfg);
  return { ...state, source, granularity, cfg, diagnostics: built.diagnostics, positions };
}

function withCheckpoint(state: WorkspaceState): WorkspaceState {
  return { ...state, undo: [...state.undo, state.positions].slice(-HISTORY_LIMIT), redo: [] };
}

function travel(state: WorkspaceState, from: "undo" | "redo", to: "undo" | "redo"): WorkspaceState {
  const snapshot = state[from].at(-1);
  if (!snapshot) return state;
  return {
    ...state,
    [from]: state[from].slice(0, -1),
    [to]: [...state[to], state.positions],
    // Nodes added after the snapshot keep their current place.
    positions: { ...state.positions, ...snapshot },
  };
}
