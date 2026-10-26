"use client";

import { useSyncExternalStore } from "react";
import {
  activeFile,
  addFile,
  createFile,
  deleteFile,
  type FileStore,
  isFileStore,
  isSavedWorkspace,
  openFile,
  renameFile,
  type SavedFile,
  saveWorkspace,
  storeOf,
  untitledName,
} from "./files";
import { SAMPLE_SOURCE } from "./sample";
import { sharedSource } from "./share";
import type { SavedWorkspace } from "./workspace-state";

const STORAGE_KEY = "pseudo-cfg:files:v1";
/** Where the single workspace lived before files existed; read once to carry it over. */
const LEGACY_STORAGE_KEY = "pseudo-cfg:workspace:v1";

const NEW_CODE = { source: "", language: "python", granularity: "block" } as const;

/** The saved files, kept outside React so the open workspace can save into them as an external system. */
let current: FileStore | null = null;
const listeners = new Set<() => void>();

function snapshot(): FileStore {
  current ??= loadInitial();
  return current;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function update(change: (store: FileStore) => FileStore) {
  current = change(snapshot());
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // Storage can be unavailable (private mode, quota); the app works without it.
  }
  for (const listener of listeners) listener();
}

/** Stores the open file's workspace. */
export const saveOpenWorkspace = (workspace: SavedWorkspace) =>
  update((store) => saveWorkspace(store, workspace, Date.now()));

const actions = {
  open: (id: string) => update((store) => openFile(store, id)),
  create: () =>
    update((store) => {
      const language = activeFile(store).workspace.language ?? "python";
      return addFile(store, createFile(untitledName(store.files), { ...NEW_CODE, language }, Date.now()));
    }),
  rename: (id: string, name: string) => update((store) => renameFile(store, id, name)),
  remove: (id: string) =>
    update((store) => deleteFile(store, id, createFile(untitledName([]), NEW_CODE, Date.now()))),
  /** Puts back a file that was deleted. */
  restore: (file: SavedFile) => update((store) => addFile(store, file)),
};

/** The saved files, restored from and saved to localStorage. */
export function useFiles() {
  const store = useSyncExternalStore(subscribe, snapshot);
  return { files: store.files, active: activeFile(store), ...actions };
}

/** A shared link's code opens as a new file, laid out afresh. */
function loadInitial(): FileStore {
  const store = loadSaved();
  const shared = sharedSource(location.hash);
  if (shared === null) return store;
  // The shared code is now a saved file; drop it from the address bar so a
  // reload opens later edits rather than adding the original code again.
  history.replaceState(null, "", location.pathname + location.search);
  return addFile(store, createFile("Shared code", { ...shared, granularity: "block" }, Date.now()));
}

function loadSaved(): FileStore {
  const saved = read(STORAGE_KEY);
  if (isFileStore(saved)) return saved;
  const legacy = read(LEGACY_STORAGE_KEY);
  if (isSavedWorkspace(legacy))
    return storeOf({ ...createFile(untitledName([]), legacy, Date.now()), workspace: legacy });
  return storeOf(createFile(untitledName([]), { ...NEW_CODE, source: SAMPLE_SOURCE }, Date.now()));
}

function read(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
