import { describe, expect, it } from "vitest";
import {
  activeFile,
  addFile,
  byRecency,
  createFile,
  deleteFile,
  isFileStore,
  renameFile,
  saveWorkspace,
  storeOf,
  untitledName,
} from "./files";

const code = { source: "x = 1", language: "python", granularity: "block" } as const;

describe("files", () => {
  it("opens a file as it is added", () => {
    const first = createFile("a", code, 1);
    const second = createFile("b", code, 2);
    const store = addFile(storeOf(first), second);
    expect(activeFile(store)).toBe(second);
    expect(byRecency(store.files).map((file) => file.name)).toEqual(["b", "a"]);
  });

  it("counts only code changes as edits", () => {
    const store = storeOf(createFile("a", code, 1));
    const { workspace } = activeFile(store);
    const moved = saveWorkspace(store, { ...workspace, positions: { n: { x: 1, y: 2 } } }, 5);
    expect(activeFile(moved).updatedAt).toBe(1);
    expect(activeFile(moved).workspace.positions).toEqual({ n: { x: 1, y: 2 } });
    const edited = saveWorkspace(moved, { ...workspace, source: "x = 2" }, 6);
    expect(activeFile(edited).updatedAt).toBe(6);
  });

  it("opens the most recently edited file when the open one is deleted", () => {
    const old = createFile("old", code, 1);
    const recent = createFile("recent", code, 3);
    const open = createFile("open", code, 2);
    const store = addFile(addFile(storeOf(old), recent), open);
    const deleted = deleteFile(store, open.id, createFile("unused", code, 4));
    expect(activeFile(deleted)).toBe(recent);
    expect(deleted.files).toHaveLength(2);
  });

  it("keeps a file open when the last one is deleted", () => {
    const only = createFile("only", code, 1);
    const replacement = createFile("new", code, 2);
    expect(deleteFile(storeOf(only), only.id, replacement)).toEqual(storeOf(replacement));
  });

  it("renames a file", () => {
    const file = createFile("a", code, 1);
    expect(activeFile(renameFile(storeOf(file), file.id, "b")).name).toBe("b");
  });

  it("names new files after the untitled ones already there", () => {
    expect(untitledName([])).toBe("Untitled");
    const files = [createFile("Untitled", code, 1), createFile("Untitled 2", code, 1)];
    expect(untitledName(files)).toBe("Untitled 3");
  });

  it("accepts only stores whose active file exists", () => {
    const store = storeOf(createFile("a", code, 1));
    expect(isFileStore(structuredClone(store))).toBe(true);
    expect(isFileStore({ ...store, activeId: "missing" })).toBe(false);
    expect(isFileStore({ activeId: "a", files: [{ id: "a" }] })).toBe(false);
  });
});
