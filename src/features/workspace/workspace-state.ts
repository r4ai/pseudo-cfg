import { buildCfg, type Cfg, type Granularity, type Language } from "@/features/cfg/build-cfg";
import type { Diagnostic } from "@/features/cfg/parse";
import { reconcile } from "@/features/cfg/reconcile";
import { type EdgeOverride, type EdgeOverrides, edgeKey } from "@/features/diagram/geometry";
import { autoLayout, mostlyReplaced, placeIncrementally, type Positions } from "@/features/diagram/layout";

export type WorkspaceState = {
  source: string;
  language: Language;
  granularity: Granularity;
  cfg: Cfg;
  diagnostics: Diagnostic[];
  positions: Positions;
  /** Edges the user has reshaped; the rest are routed automatically. */
  edges: EdgeOverrides;
  /** Layout history for undo/redo in the diagram; the editor keeps its own text history. */
  undo: LayoutSnapshot[];
  redo: LayoutSnapshot[];
  /** Bumped whenever the whole layout is replaced, so the view can fit the new graph. */
  layoutEpoch: number;
};

/** A diagram arrangement. The graph is kept so a granularity switch can be undone with its ids. */
type LayoutSnapshot = Pick<WorkspaceState, "granularity" | "cfg" | "positions" | "edges">;

/** What is persisted between visits. Ids in `cfg` let saved positions survive a reload. */
export type SavedWorkspace = Pick<WorkspaceState, "source" | "granularity" | "cfg" | "positions"> & {
  /** Missing from workspaces saved before edges could be reshaped. */
  edges?: EdgeOverrides;
  /** Missing from workspaces saved before CUDA-like code was supported. */
  language?: Language;
};

export type WorkspaceAction =
  | { type: "edit"; source: string }
  | { type: "setGranularity"; granularity: Granularity }
  /** Switches the syntax the source is read in, along with the source written in it. */
  | { type: "setLanguage"; language: Language; source: string }
  | { type: "move"; positions: Positions }
  /** Replaces how the user shaped an edge; null routes it automatically again. */
  | { type: "shapeEdge"; key: string; override: EdgeOverride | null }
  | { type: "checkpoint" }
  | { type: "tidy" }
  | { type: "undo" }
  | { type: "redo" };

const HISTORY_LIMIT = 100;

const createId = () => crypto.randomUUID().slice(0, 8);

export function initWorkspace(saved: SavedWorkspace): WorkspaceState {
  return rebuild(
    {
      ...saved,
      language: saved.language ?? "python",
      edges: saved.edges ?? {},
      diagnostics: [],
      undo: [],
      redo: [],
      layoutEpoch: 0,
    },
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
    case "setLanguage":
      return rebuild({ ...state, language: action.language }, action.source, state.granularity);
    case "move":
      return { ...state, positions: { ...state.positions, ...action.positions } };
    case "shapeEdge": {
      const { [action.key]: _, ...rest } = state.edges;
      return { ...state, edges: action.override ? { ...rest, [action.key]: action.override } : rest };
    }
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
  const built = buildCfg(source, granularity, state.language);
  const cfg = reconcile(state.cfg, built.cfg, createId);
  const next = {
    ...state,
    source,
    granularity,
    cfg,
    diagnostics: built.diagnostics,
    edges: kept(state.edges, cfg),
  };
  // Laying out afresh discards manual positions, so it can be undone from the diagram.
  if (mostlyReplaced(state.cfg, state.positions, cfg)) return relaid(withCheckpoint(next));
  return { ...next, positions: placeIncrementally(state.cfg, state.positions, cfg) };
}

/** A fresh layout routes every edge afresh too. */
function relaid(state: WorkspaceState): WorkspaceState {
  return { ...state, positions: autoLayout(state.cfg), edges: {}, layoutEpoch: state.layoutEpoch + 1 };
}

/** The overrides of edges that are still in `cfg`. */
function kept(edges: EdgeOverrides, cfg: Cfg): EdgeOverrides {
  const keys = new Set(cfg.edges.map(edgeKey));
  return Object.fromEntries(Object.entries(edges).filter(([key]) => keys.has(key)));
}

const snapshotOf = ({ granularity, cfg, positions, edges }: WorkspaceState): LayoutSnapshot => ({
  granularity,
  cfg,
  positions,
  edges,
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
    const restored = {
      ...moved,
      cfg: snapshot.cfg,
      positions: snapshot.positions,
      edges: kept(snapshot.edges, state.cfg),
    };
    // The graph changes wholesale, so the view fits it as after a switch.
    const rebuilt = rebuild(restored, state.source, snapshot.granularity);
    return { ...rebuilt, layoutEpoch: Math.max(rebuilt.layoutEpoch, state.layoutEpoch + 1) };
  }
  // Nodes added after the snapshot keep their current place.
  return {
    ...moved,
    positions: { ...state.positions, ...snapshot.positions },
    edges: kept(snapshot.edges, state.cfg),
  };
}
