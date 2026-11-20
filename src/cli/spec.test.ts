import { describe, expect, it } from "vitest";
import { inspectWorkspace } from "@/features/workspace/diagram-ops";
import {
  compileYamlSpec,
  hasCustomLayout,
  looksLikeYamlSpec,
  workspaceToYaml,
} from "@/features/workspace/spec";
import { initWorkspace, workspaceReducer } from "@/features/workspace/workspace-state";

const YAML_SPEC = `language: python
granularity: block
source: |
  def classify(x):
      if x > 0:
          y = 1
      else:
          y = -1
      return y

layout:
  nodes:
    "y = -1":
      leftOf: "if x > 0"
      gap: 48
  edges:
    "if x > 0 -> y = -1 [F]":
      from: left
      to: top
`;

describe("declarative YAML spec", () => {
  it("compiles semantic node placements and edge routes on top of auto-layout", () => {
    const { workspace, diagnostics } = compileYamlSpec(YAML_SPEC);
    expect(diagnostics).toEqual([]);

    const info = inspectWorkspace(workspace);
    const cond = info.nodes.find((n) => n.label === "if x > 0");
    const neg = info.nodes.find((n) => n.label === "y = -1");
    expect(cond).toBeDefined();
    expect(neg).toBeDefined();
    expect(neg!.x).toBeCloseTo(cond!.x - neg!.width - 48, 1);
    expect(neg!.cy).toBeCloseTo(cond!.cy, 1);

    const falseEdge = info.edges.find((e) => e.source === cond!.id && e.target === neg!.id);
    expect(falseEdge?.sourceSide).toBe("left");
    expect(falseEdge?.targetSide).toBe("top");
    expect(info.quality.ok).toBe(true);
  });

  it("supports edge segment shifting and explicit via waypoints in YAML", () => {
    const base = compileYamlSpec(`language: python
source: |
  def f(x):
      if x > 0:
          return 1
      return -1
`);
    const info = inspectWorkspace(base.workspace);
    const jumpEdge = info.edges.find(
      (e) => e.jump && e.source === info.nodes.find((n) => n.label === "return 1")?.id,
    );
    expect(jumpEdge).toBeDefined();

    const shifted = compileYamlSpec(`language: python
source: |
  def f(x):
      if x > 0:
          return 1
      return -1
layout:
  edges:
    "return 1 -> return":
      from: right
      to: right
      shift:
        - segment: 1
          at: 420
`);
    const after = inspectWorkspace(shifted.workspace);
    const updatedEdge = after.edges.find((e) => e.key === jumpEdge!.key);
    expect(updatedEdge?.sourceSide).toBe("right");
    expect(updatedEdge?.targetSide).toBe("right");
    expect(updatedEdge?.segments.some((s) => s.orientation === "vertical" && s.coord === 420)).toBe(true);
  });

  it("exports a modified workspace to YAML and roundtrips cleanly", () => {
    const { workspace } = compileYamlSpec(YAML_SPEC);
    const exported = workspaceToYaml(workspace);
    expect(exported).toContain("language: python");
    expect(exported).toContain("layout:");

    const recompiled = compileYamlSpec(exported);
    expect(recompiled.workspace.positions).toEqual(workspace.positions);
    expect(recompiled.workspace.edges).toEqual(workspace.edges);
  });

  it("remaps browser UUID node IDs to canonical IDs when exporting to YAML and round-trips into browser reducer", () => {
    // Simulate a browser workspace created with random 8-char UUID node IDs
    let state = initWorkspace({
      source: "if x > 0:\n    a()\nelse:\n    b()\nc()\n",
      language: "python",
      granularity: "block",
      cfg: { nodes: [], edges: [] },
      positions: {},
      edges: {},
    });
    expect(hasCustomLayout(state)).toBe(false);

    const bNode = state.cfg.nodes.find((n) => n.label === "b()");
    const condNode = state.cfg.nodes.find((n) => n.label === "if x > 0");
    if (!bNode || !condNode) throw new Error("missing nodes");

    state = workspaceReducer(state, { type: "move", positions: { [bNode.id]: { x: -160, y: 120 } } });
    state = workspaceReducer(state, {
      type: "shapeEdge",
      key: `${condNode.id}>${bNode.id}:False`,
      override: { source: "left", target: "top" },
    });
    expect(hasCustomLayout(state)).toBe(true);

    const yaml = workspaceToYaml(state);
    expect(yaml).not.toContain(bNode.id);
    expect(yaml).toContain("from: left");

    // Recompile YAML and load back into browser workspace reducer (like UI Import YAML / #spec= link)
    const compiled = compileYamlSpec(yaml);
    const loaded = workspaceReducer(state, { type: "load", workspace: compiled.workspace });
    const loadedB = loaded.cfg.nodes.find((n) => n.label === "b()");
    expect(loadedB).toBeDefined();
    expect(loaded.positions[loadedB!.id]).toEqual({ x: -160, y: 120 });
    expect(Object.values(loaded.edges)).toContainEqual({ source: "left", target: "top" });
  });

  it("distinguishes YAML specs from raw Python or CUDA source", () => {
    expect(looksLikeYamlSpec(YAML_SPEC)).toBe(true);
    expect(looksLikeYamlSpec("def f(x):\n    return x\n")).toBe(false);
    expect(looksLikeYamlSpec("__global__ void k(int n) { return; }\n")).toBe(false);
  });
});
