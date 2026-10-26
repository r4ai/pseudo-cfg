import type { Granularity, Language } from "@/features/cfg/build-cfg";
import type { SavedWorkspace } from "./workspace-state";

/** A named workspace the user can come back to. */
export type SavedFile = {
  id: string;
  name: string;
  /** Milliseconds since the epoch; the file list shows the most recent first. */
  updatedAt: number;
  workspace: SavedWorkspace;
};

/** Every saved file and the one open in the editor, which is always one of them. */
export type FileStore = {
  activeId: string;
  files: SavedFile[];
};

const UNTITLED = "Untitled";

const EMPTY_LAYOUT: Pick<SavedWorkspace, "cfg" | "positions" | "edges"> = {
  cfg: { nodes: [], edges: [] },
  positions: {},
  edges: {},
};

export function createFile(
  name: string,
  code: Pick<SavedWorkspace, "source" | "language" | "granularity">,
  now: number,
): SavedFile {
  return { id: crypto.randomUUID(), name, updatedAt: now, workspace: { ...code, ...EMPTY_LAYOUT } };
}

/** A store holding `file` alone. */
export const storeOf = (file: SavedFile): FileStore => ({ activeId: file.id, files: [file] });

export function activeFile(store: FileStore): SavedFile {
  const file = store.files.find(({ id }) => id === store.activeId);
  if (!file) throw new Error(`No file has the active id ${store.activeId}`);
  return file;
}

/** Adds `file` and opens it. */
export const addFile = (store: FileStore, file: SavedFile): FileStore => ({
  activeId: file.id,
  files: [...store.files, file],
});

export const openFile = (store: FileStore, id: string): FileStore =>
  store.files.some((file) => file.id === id) ? { ...store, activeId: id } : store;

/**
 * Stores the open file's workspace. Only a change to the code counts as an edit for
 * the file's recency, so merely opening a file or moving its nodes does not reorder the list.
 */
export function saveWorkspace(store: FileStore, workspace: SavedWorkspace, now: number): FileStore {
  return update(store, store.activeId, (file) => {
    const edited =
      file.workspace.source !== workspace.source ||
      file.workspace.language !== workspace.language ||
      file.workspace.granularity !== workspace.granularity;
    return { ...file, workspace, updatedAt: edited ? now : file.updatedAt };
  });
}

export function renameFile(store: FileStore, id: string, name: string): FileStore {
  return update(store, id, (file) => ({ ...file, name }));
}

/**
 * Removes a file. Deleting the open file opens the most recently edited of the rest;
 * deleting the last file leaves `replacement` so that something is always open.
 */
export function deleteFile(store: FileStore, id: string, replacement: SavedFile): FileStore {
  const files = store.files.filter((file) => file.id !== id);
  const [mostRecent] = byRecency(files);
  if (!mostRecent) return storeOf(replacement);
  return { activeId: store.activeId === id ? mostRecent.id : store.activeId, files };
}

const nthUntitled = (n: number) => (n === 1 ? UNTITLED : `${UNTITLED} ${n}`);

/** "Untitled", or "Untitled 2" and so on when that name is taken. */
export function untitledName(files: SavedFile[]): string {
  const names = new Set(files.map((file) => file.name));
  let n = 1;
  while (names.has(nthUntitled(n))) n++;
  return nthUntitled(n);
}

/** Most recently edited first. */
export const byRecency = (files: SavedFile[]): SavedFile[] =>
  files.toSorted((a, b) => b.updatedAt - a.updatedAt);

function update(store: FileStore, id: string, change: (file: SavedFile) => SavedFile): FileStore {
  return { ...store, files: store.files.map((file) => (file.id === id ? change(file) : file)) };
}

const GRANULARITIES: ReadonlySet<unknown> = new Set<Granularity>(["block", "statement"]);
const LANGUAGES: ReadonlySet<unknown> = new Set<Language>(["python", "cuda"]);

export function isFileStore(value: unknown): value is FileStore {
  if (!isRecord(value) || typeof value.activeId !== "string" || !Array.isArray(value.files)) return false;
  return value.files.every(isSavedFile) && value.files.some((file) => file.id === value.activeId);
}

function isSavedFile(value: unknown): value is SavedFile {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.updatedAt === "number" &&
    isSavedWorkspace(value.workspace)
  );
}

export function isSavedWorkspace(value: unknown): value is SavedWorkspace {
  if (!isRecord(value)) return false;
  const cfg = value.cfg;
  return (
    typeof value.source === "string" &&
    GRANULARITIES.has(value.granularity) &&
    isRecord(value.positions) &&
    (value.language === undefined || LANGUAGES.has(value.language)) &&
    (value.edges === undefined || isRecord(value.edges)) &&
    isRecord(cfg) &&
    Array.isArray(cfg.nodes) &&
    Array.isArray(cfg.edges)
  );
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
