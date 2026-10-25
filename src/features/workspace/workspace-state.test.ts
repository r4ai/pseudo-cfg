import { describe, expect, it } from "vitest";
import { edgeKey } from "@/features/diagram/geometry";
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

const start = () =>
  initWorkspace({ source, granularity: "block", cfg: { nodes: [], edges: [] }, positions: {} });

describe("reshaping edges", () => {
  it("keeps a reshaped edge through edits and undoes it like a move", () => {
    const before = start();
    const key = edgeKey(before.cfg.edges[0] as (typeof before.cfg.edges)[number]);
    const shaped = workspaceReducer(workspaceReducer(before, { type: "checkpoint" }), {
      type: "shapeEdge",
      key,
      override: { source: "left" },
    });
    expect(shaped.edges).toEqual({ [key]: { source: "left" } });

    const edited = workspaceReducer(shaped, { type: "edit", source: source.replace("b = 2", "b = 3") });
    expect(edited.edges).toEqual(shaped.edges);
    expect(workspaceReducer(shaped, { type: "undo" }).edges).toEqual({});
  });

  it("routes every edge afresh on tidy up", () => {
    const before = start();
    const key = edgeKey(before.cfg.edges[0] as (typeof before.cfg.edges)[number]);
    const shaped = workspaceReducer(before, { type: "shapeEdge", key, override: { target: "left" } });
    expect(workspaceReducer(shaped, { type: "tidy" }).edges).toEqual({});
  });

  it("forgets edges that are gone", () => {
    const before = start();
    const shaped = workspaceReducer(before, { type: "shapeEdge", key: "x>y:", override: { source: "left" } });
    expect(
      workspaceReducer(shaped, {
        type: "edit",
        source: `${source}
`,
      }).edges,
    ).toEqual({});
  });
});

describe("adding a function", () => {
  it("keeps the existing arrangement when a new def is added", () => {
    const before = initWorkspace({
      source: "a()\nb()",
      granularity: "block",
      cfg: { nodes: [], edges: [] },
      positions: {},
    });
    const added = "a()\nb()\ndef g(x):\n    if x:\n        return 1\n    y()\n    return 2";
    const after = workspaceReducer(before, { type: "edit", source: added });
    expect(after.layoutEpoch).toBe(before.layoutEpoch);
    for (const node of before.cfg.nodes) expect(after.positions[node.id]).toEqual(before.positions[node.id]);
  });
});
