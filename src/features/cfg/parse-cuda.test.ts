import { describe, expect, it } from "vitest";
import { buildCfg, type Cfg } from "./build-cfg";

/** Renders edges as `source -label-> target` using node labels, for readable assertions. */
function edgesOf({ nodes, edges }: Cfg): string[] {
  const label = (id: string) => nodes.find((n) => n.id === id)?.label.replaceAll("\n", "; ");
  return edges.map(
    (e) => `${label(e.source)} -${e.label ?? ""}${e.back ? "(back)" : ""}-> ${label(e.target)}`,
  );
}

const build = (source: string) => buildCfg(source, "block", "cuda");

describe("buildCfg for CUDA-like code", () => {
  it("builds if / else if / else, with and without braces", () => {
    const src = [
      "if (x > 0) {",
      "  s = 1;",
      "} else if (x < 0)",
      "  s = -1;",
      "else { s = 0; }",
      "print(s);",
    ].join("\n");
    expect(edgesOf(build(src).cfg)).toEqual([
      "Start --> if (x > 0)",
      "if (x > 0) -True-> s = 1",
      "if (x > 0) -False-> else if (x < 0)",
      "else if (x < 0) -True-> s = -1",
      "else if (x < 0) -False-> s = 0",
      "s = 1 --> print(s)",
      "s = -1 --> print(s)",
      "s = 0 --> print(s)",
      "print(s) --> End",
    ]);
  });

  it("makes one graph per function and leaves out top-level declarations", () => {
    const src = [
      "#include <cstdio>",
      "#define N 256",
      "__constant__ float k[4];",
      "struct P { float x, y; };",
      "__global__ void add(int n,",
      "                    float *y) {",
      "  int i = threadIdx.x; // index",
      "  /* guard */ if (i < n) y[i] += 1;",
      "}",
      "int main() { add<<<1, N>>>(N, y); return 0; }",
    ].join("\n");
    const { cfg, diagnostics } = build(src);
    expect(diagnostics).toEqual([]);
    expect(edgesOf(cfg)).toEqual([
      "__global__ void add(int n, float *y) --> int i = threadIdx.x",
      "int i = threadIdx.x --> if (i < n)",
      "if (i < n) -True-> y[i] += 1",
      "y[i] += 1 --> return",
      "if (i < n) -False-> return",
      "int main() --> add<<<1, N>>>(N, y); return 0",
      "add<<<1, N>>>(N, y); return 0 --> return",
    ]);
    expect(cfg.nodes[0]).toMatchObject({ line: 5, endLine: 6 });
  });

  it("routes break and continue in for and while loops", () => {
    const src = [
      "for (int i = 0; i < n; i++) {",
      "  if (a[i] < 0) break;",
      "  if (a[i] == 0) continue;",
      "  use(a[i]);",
      "}",
      "while (true) { if (done()) break; }",
    ].join("\n");
    expect(edgesOf(build(src).cfg)).toEqual([
      "Start --> for (int i = 0; i < n; i++)",
      "for (int i = 0; i < n; i++) -next-> if (a[i] < 0)",
      "if (a[i] < 0) -False-> if (a[i] == 0)",
      "if (a[i] == 0) -True(back)-> for (int i = 0; i < n; i++)",
      "if (a[i] == 0) -False-> use(a[i])",
      "use(a[i]) -(back)-> for (int i = 0; i < n; i++)",
      "for (int i = 0; i < n; i++) -done-> while (true)",
      "if (a[i] < 0) -True-> while (true)",
      "while (true) -True-> if (done())",
      "if (done()) -False(back)-> while (true)",
      "if (done()) -True-> End",
    ]);
  });

  it("drops the exit of `for (;;)`", () => {
    const { cfg } = build("for (;;) tick();");
    expect(edgesOf(cfg)).toEqual([
      "Start --> for (;;)",
      "for (;;) -next-> tick()",
      "tick() -(back)-> for (;;)",
    ]);
  });

  it("tests the condition of do / while after the body", () => {
    const src = ["do {", "  s++;", "  if (s == 3) continue;", "  t();", "} while (s < 5);", "u();"].join(
      "\n",
    );
    const { cfg } = build(src);
    expect(edgesOf(cfg)).toEqual([
      "Start --> do",
      "do -next-> s++",
      "s++ --> if (s == 3)",
      "if (s == 3) -True-> while (s < 5)",
      "if (s == 3) -False-> t()",
      "t() --> while (s < 5)",
      "while (s < 5) -True(back)-> do",
      "while (s < 5) -False-> u()",
      "u() --> End",
    ]);
    expect(cfg.nodes.find((n) => n.label === "while (s < 5)")).toMatchObject({ line: 5 });
  });

  it("chains switch cases, falls through, and breaks out of the switch", () => {
    const src = [
      "switch (k) {",
      "case 0: a(); break;",
      "case Color::Red:",
      "case 2: b();",
      "default: c();",
      "}",
      "d();",
    ].join("\n");
    expect(edgesOf(build(src).cfg)).toEqual([
      "Start --> switch (k)",
      "switch (k) --> case 0",
      "case 0 -False-> case Color::Red",
      "case Color::Red -False-> case 2",
      "case 0 -True-> a()",
      "case Color::Red -True-> b()",
      "case 2 -True-> b()",
      "b() --> c()",
      "case 2 -False-> c()",
      "c() --> d()",
      "a() --> d()",
      "d() --> End",
    ]);
  });

  it("lets continue inside a switch reach the enclosing loop", () => {
    const src = "while (a) {\n  switch (k) { case 1: continue; }\n  b();\n}";
    expect(edgesOf(build(src).cfg)).toContain("case 1 -True(back)-> while (a)");
  });

  it("keeps braces of initializers and lambdas inside their statement", () => {
    const src = "int v[] = {1, 2};\nauto f = [&](int x) { return x; };\ng();";
    const { cfg, diagnostics } = build(src);
    expect(diagnostics).toEqual([]);
    expect(edgesOf(cfg)).toEqual([
      "Start --> int v[] = {1, 2}; auto f = [&](int x) { return x; }; g()",
      "int v[] = {1, 2}; auto f = [&](int x) { return x; }; g() --> End",
    ]);
  });

  it("ignores braces, semicolons and comment markers inside strings", () => {
    const { cfg } = build("puts(\"{ ; // }\");\nputs('}');");
    expect(cfg.nodes.map((n) => n.label)).toContain("puts(\"{ ; // }\")\nputs('}')");
  });

  it("reports what it cannot make sense of while the code is being typed", () => {
    const { diagnostics } = build("void f() {\n  if (a) {\n    b()\n  }\n  x();\n  else c();\n  break;");
    expect(diagnostics.map((d) => [d.line, d.message])).toEqual([
      [1, "'{' was never closed"],
      [3, "Expected ';'"],
      [6, "'else' without a matching 'if'"],
      [7, "'break' outside loop"],
    ]);
  });

  it("approximates try / catch like Python's try / except", () => {
    const { cfg, diagnostics } = build("try { a(); } catch (const E &e) { b(); }\nc();");
    expect(diagnostics.map((d) => d.severity)).toEqual(["warning"]);
    expect(edgesOf(cfg)).toContain("try; a() --> catch (const E &e)");
  });
});
