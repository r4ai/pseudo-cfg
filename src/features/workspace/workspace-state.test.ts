import { describe, expect, it } from "vitest";
import { initWorkspace, workspaceReducer } from "./workspace-state";

const source = "def f(x):\n    a = 1\n    b = 2\n    if x:\n        a += 1\n    return a + b";

describe("workspaceReducer", () => {
  it("undoes a granularity switch together with its layout", () => {
    const blocks = initWorkspace({
      source,
      granularity: "block",
      cfg: { nodes: [], edges: [] },
      positions: {},
    });
    const statements = workspaceReducer(blocks, { type: "setGranularity", granularity: "statement" });
    const undone = workspaceReducer(statements, { type: "undo" });
    expect(undone.granularity).toBe("block");
    expect(undone.cfg.nodes.map((n) => n.id)).toEqual(blocks.cfg.nodes.map((n) => n.id));
    expect(undone.positions).toEqual(blocks.positions);

    const redone = workspaceReducer(undone, { type: "redo" });
    expect(redone.granularity).toBe("statement");
    expect(redone.cfg.nodes).toHaveLength(statements.cfg.nodes.length);
  });

  it("lays the graph out afresh when the whole text is replaced", () => {
    const before = initWorkspace({
      source,
      granularity: "block",
      cfg: { nodes: [], edges: [] },
      positions: {},
    });
    const after = workspaceReducer(before, { type: "edit", source: "for x in xs:\n    print(x)" });
    expect(after.layoutEpoch).toBe(before.layoutEpoch + 1);
  });

  it("keeps the layout while a statement is being edited", () => {
    const before = initWorkspace({
      source,
      granularity: "block",
      cfg: { nodes: [], edges: [] },
      positions: {},
    });
    const after = workspaceReducer(before, { type: "edit", source: source.replace("b = 2", "b = 3") });
    expect(after.layoutEpoch).toBe(before.layoutEpoch);
  });
});
