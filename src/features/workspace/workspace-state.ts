import { buildCfg, type Cfg, type Granularity } from "@/features/cfg/build-cfg";
import type { Diagnostic } from "@/features/cfg/parse";
import { reconcile } from "@/features/cfg/reconcile";
import { autoLayout, mostlyReplaced, placeIncrementally, type Positions } from "@/features/diagram/layout";

export type WorkspaceState = {
  source: string;
  granularity: Granularity;
  cfg: Cfg;
  diagnostics: Diagnostic[];
  positions: Positions;
  /** Layout history for undo/redo in the diagram; the editor keeps its own text history. */
  undo: LayoutSnapshot[];
  redo: LayoutSnapshot[];
  /** Bumped whenever the whole layout is replaced, so the view can fit the new graph. */
  layoutEpoch: number;
};

/** A diagram arrangement. The graph is kept so a granularity switch can be undone with its ids. */
type LayoutSnapshot = Pick<WorkspaceState, "granularity" | "cfg" | "positions">;

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
  return rebuild(
    { ...saved, diagnostics: [], undo: [], redo: [], layoutEpoch: 0 },
    saved.source,
    saved.granularity,
  );
}

export function workspaceReducer(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
  switch (action.type) {
    case "edit":
      return rebuild(state, action.source, state.granularity);
    case "setGranularity": {
      // The node structure changes wholesale, so a fresh layout reads better than an incremental one.
      const next = rebuild(withCheckpoint(state), state.source, action.granularity);
      return relaid(next);
    }
    case "move":
      return { ...state, positions: { ...state.positions, ...action.positions } };
    case "checkpoint":
      return withCheckpoint(state);
    case "tidy":
      return relaid(withCheckpoint(state));
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
  const next = { ...state, source, granularity, cfg, diagnostics: built.diagnostics };
  if (mostlyReplaced(state.cfg, state.positions, cfg)) return relaid(next);
  return { ...next, positions: placeIncrementally(state.cfg, state.positions, cfg) };
}

function relaid(state: WorkspaceState): WorkspaceState {
  return { ...state, positions: autoLayout(state.cfg), layoutEpoch: state.layoutEpoch + 1 };
}

const snapshotOf = ({ granularity, cfg, positions }: WorkspaceState): LayoutSnapshot => ({
  granularity,
  cfg,
  positions,
});

function withCheckpoint(state: WorkspaceState): WorkspaceState {
  return { ...state, undo: [...state.undo, snapshotOf(state)].slice(-HISTORY_LIMIT), redo: [] };
}

function travel(state: WorkspaceState, from: "undo" | "redo", to: "undo" | "redo"): WorkspaceState {
  const snapshot = state[from].at(-1);
  if (!snapshot) return state;
  const moved = { ...state, [from]: state[from].slice(0, -1), [to]: [...state[to], snapshotOf(state)] };
  if (snapshot.granularity !== state.granularity) {
    // Rebuild against the snapshot's graph so its ids, and so its positions, carry over.
    const restored = { ...moved, cfg: snapshot.cfg, positions: snapshot.positions };
    // The graph changes wholesale, so the view fits it as after a switch.
    const rebuilt = rebuild(restored, state.source, snapshot.granularity);
    return { ...rebuilt, layoutEpoch: Math.max(rebuilt.layoutEpoch, state.layoutEpoch + 1) };
  }
  // Nodes added after the snapshot keep their current place.
  return { ...moved, positions: { ...state.positions, ...snapshot.positions } };
}
