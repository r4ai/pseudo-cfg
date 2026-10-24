import { describe, expect, it } from "vitest";
import { buildCfg, type Cfg } from "./build-cfg";

/** Renders edges as `source -label-> target` using node labels, for readable assertions. */
function edgesOf({ nodes, edges }: Cfg): string[] {
  const label = (id: string) => nodes.find((n) => n.id === id)?.label.replaceAll("\n", "; ");
  return edges.map(
    (e) => `${label(e.source)} -${e.label ?? ""}${e.back ? "(back)" : ""}-> ${label(e.target)}`,
  );
}

describe("buildCfg", () => {
  it("merges straight-line code into one basic block", () => {
    const { cfg } = buildCfg("a = 1\nb = 2", "block");
    expect(edgesOf(cfg)).toEqual(["Start --> a = 1; b = 2", "a = 1; b = 2 --> End"]);
  });

  it("keeps one node per statement in statement mode", () => {
    const { cfg } = buildCfg("a = 1\nb = 2", "statement");
    expect(edgesOf(cfg)).toEqual(["Start --> a = 1", "a = 1 --> b = 2", "b = 2 --> End"]);
  });

  it("builds if / elif / else", () => {
    const src = [
      "if x > 0:",
      "    s = 1",
      "elif x < 0:",
      "    s = -1",
      "else:",
      "    s = 0",
      "print(s)",
    ].join("\n");
    expect(edgesOf(buildCfg(src, "block").cfg)).toEqual([
      "Start --> if x > 0",
      "if x > 0 -True-> s = 1",
      "if x > 0 -False-> elif x < 0",
      "elif x < 0 -True-> s = -1",
      "elif x < 0 -False-> s = 0",
      "s = 1 --> print(s)",
      "s = -1 --> print(s)",
      "s = 0 --> print(s)",
      "print(s) --> End",
    ]);
  });

  it("routes break, continue and return", () => {
    const src = [
      "def f(xs):",
      "    for x in xs:",
      "        if x < 0:",
      "            break",
      "        if x == 0:",
      "            continue",
      "        use(x)",
      "    return 1",
    ].join("\n");
    expect(edgesOf(buildCfg(src, "block").cfg)).toEqual([
      "def f(xs) --> for x in xs",
      "for x in xs -next-> if x < 0",
      "if x < 0 -False-> if x == 0",
      "if x == 0 -True(back)-> for x in xs",
      "if x == 0 -False-> use(x)",
      "use(x) -(back)-> for x in xs",
      "for x in xs -done-> return 1",
      "if x < 0 -True-> return 1",
      "return 1 --> return",
    ]);
  });

  it("drops the False exit of `while True`", () => {
    const { cfg } = buildCfg("while True:\n    tick()", "block");
    expect(edgesOf(cfg)).toEqual([
      "Start --> while True",
      "while True -True-> tick()",
      "tick() -(back)-> while True",
    ]);
  });

  it("supports inline bodies and joined lines", () => {
    const { cfg } = buildCfg("if a: return f(1,\n  2)\nb = 3", "block");
    expect(edgesOf(cfg)).toContain("if a -True-> return f(1, 2)");
  });

  it("skips the empty top-level graph when the file only defines functions", () => {
    const { cfg } = buildCfg("def f():\n    pass\ndef g():\n    pass", "block");
    expect(cfg.nodes.filter((n) => n.kind === "start").map((n) => n.label)).toEqual(["def f()", "def g()"]);
  });

  it("reports structural problems", () => {
    const { diagnostics } = buildCfg("if x:\nbreak\nelse:\n  y", "block");
    expect(diagnostics.map((d) => d.message)).toEqual([
      "Expected an indented block",
      "'else' without a matching 'if'",
      "'break' outside loop",
    ]);
  });

  it("ignores comments, including `#` inside strings", () => {
    const { cfg } = buildCfg("# heading\nprint('#1')  # trailing", "block");
    expect(cfg.nodes.map((n) => n.label)).toEqual(["Start", "print('#1')", "End"]);
  });
});
