import type { Diagnostic, Program, Stmt } from "./parse";
import { parse } from "./parse";
import { parseCuda } from "./parse-cuda";

export type CfgNodeKind = "start" | "end" | "block" | "branch" | "loop";

export type CfgNode = {
  id: string;
  kind: CfgNodeKind;
  label: string;
  /** 1-based source range the node was built from. */
  line: number;
  endLine: number;
};

export type CfgEdge = {
  source: string;
  target: string;
  label: string | null;
  /** True for edges that jump back to a loop header. */
  back: boolean;
  /**
   * True for `break`, `return` and `raise`, which leave the structure they are in,
   * and for the exit of `do ... while`, which leaves the loop from the bottom of its body.
   */
  jump: boolean;
};

export type Cfg = { nodes: CfgNode[]; edges: CfgEdge[] };

export type Granularity = "block" | "statement";

/** The pseudocode syntax: indentation-based like Python, or brace-delimited like CUDA C++. */
export type Language = "python" | "cuda";

const PARSERS: Record<Language, (source: string) => Program> = { python: parse, cuda: parseCuda };

export type BuildResult = { cfg: Cfg; diagnostics: Diagnostic[] };

/** A dangling control-flow exit waiting to be connected to the next node. */
type Port = { from: string; label: string | null; jump?: boolean };

/**
 * Where `break` and `continue` lead inside a loop or `switch`. `head` is the node `continue`
 * goes to, null in a `switch` outside any loop; `back` tells whether that edge goes back up.
 */
type Loop = { head: string | null; back: boolean; breaks: Port[] };

/**
 * Builds one graph per scope (top-level code and every `def`).
 * Node ids are only unique within this result; see `reconcile` for stable ids.
 */
export function buildCfg(
  source: string,
  granularity: Granularity,
  language: Language = "python",
): BuildResult {
  const program = PARSERS[language](source);
  const builder = new Builder(granularity, program.diagnostics);
  const hasTopLevelCode = program.body.some((stmt) => stmt.type !== "def");
  const hasDefs = program.body.length > 0 && !hasTopLevelCode;
  if (hasDefs) builder.collectDefs(program.body);
  else builder.scope("Start", "End", 1, program.body);
  builder.flushDefs();
  builder.reportUnreachable();
  return {
    cfg: { nodes: builder.nodes, edges: builder.edges },
    diagnostics: program.diagnostics.toSorted((a, b) => a.line - b.line),
  };
}

class Builder {
  readonly nodes: CfgNode[] = [];
  readonly edges: CfgEdge[] = [];
  private readonly pendingDefs: Extract<Stmt, { type: "def" }>[] = [];
  private exit = "";
  private nextId = 0;

  constructor(
    private readonly granularity: Granularity,
    private readonly diagnostics: Diagnostic[],
  ) {}

  scope(startLabel: string, endLabel: string, line: number, body: Stmt[], headerEnd = line) {
    const start = this.add("start", startLabel, line, headerEnd);
    const outer = this.exit;
    this.exit = `n${this.nextId++}`;
    const end: CfgNode = { id: this.exit, kind: "end", label: endLabel, line, endLine: line };
    const ports = this.sequence(body, [{ from: start, label: null }], null);
    this.connect(ports, end.id);
    this.nodes.push(end);
    this.exit = outer;
  }

  /** Function bodies become separate graphs, emitted after the scope that defines them. */
  collectDefs(stmts: Stmt[]) {
    for (const stmt of stmts) if (stmt.type === "def") this.pendingDefs.push(stmt);
  }

  flushDefs() {
    for (let def = this.pendingDefs.shift(); def; def = this.pendingDefs.shift()) {
      this.scope(def.header, "return", def.line, def.body, def.endLine);
    }
  }

  /** Warns about statements no path from their scope's start reaches, such as code after `return`. */
  reportUnreachable() {
    const reached = new Set(this.nodes.filter((n) => n.kind === "start").map((n) => n.id));
    for (const id of reached) {
      for (const edge of this.edges) if (edge.source === id) reached.add(edge.target);
    }
    for (const node of this.nodes) {
      if (node.kind === "end" || reached.has(node.id)) continue;
      this.diagnostics.push({ line: node.line, message: "Unreachable code", severity: "warning" });
    }
  }

  private sequence(stmts: Stmt[], incoming: Port[], loop: Loop | null): Port[] {
    let ports = incoming;
    /** The basic block that `ports` falls out of, when statements may still be appended to it. */
    let open: string | null = null;

    for (const stmt of stmts) {
      if (stmt.type === "simple" || stmt.type === "return") {
        if (open !== null && this.granularity === "block") this.append(open, stmt.text, stmt.endLine);
        else {
          open = this.add("block", stmt.text, stmt.line, stmt.endLine);
          this.connect(ports, open);
        }
        ports = [{ from: open, label: stmt.type === "return" && stmt.raises ? "raise" : null }];
        if (stmt.type === "return") {
          this.connect(
            ports.map((port) => ({ ...port, jump: true })),
            this.exit,
          );
          ports = [];
          open = null;
        }
        continue;
      }
      open = null;
      ports = this.compound(stmt, ports, loop);
    }
    return ports;
  }

  private compound(
    stmt: Exclude<Stmt, { type: "simple" | "return" }>,
    ports: Port[],
    loop: Loop | null,
  ): Port[] {
    switch (stmt.type) {
      case "if":
        return this.ifChain(stmt.branches, ports, loop);
      case "while":
        return this.loop("branch", `while ${stmt.cond}`, stmt, ports, stmt.body, stmt.orelse, loop, {
          enter: "True",
          leave: stmt.infinite ? null : "False",
        });
      case "for":
        return this.loop("loop", `for ${stmt.head}`, stmt, ports, stmt.body, stmt.orelse, loop, {
          enter: "next",
          leave: stmt.infinite ? null : "done",
        });
      case "do":
        return this.doWhile(stmt, ports);
      case "switch":
        return this.switchCases(stmt, ports, loop);
      case "break":
        if (loop) loop.breaks.push(...ports.map((port) => ({ ...port, jump: true })));
        else this.report(stmt.line, "'break' outside loop");
        return loop ? [] : ports;
      case "continue":
        if (loop?.head) this.connect(ports, loop.head, loop.back);
        else this.report(stmt.line, "'continue' outside loop");
        return loop?.head ? [] : ports;
      case "def":
        this.pendingDefs.push(stmt);
        return ports;
    }
  }

  private ifChain(
    branches: Extract<Stmt, { type: "if" }>["branches"],
    ports: Port[],
    loop: Loop | null,
    keyword: "if" | "elif" = "if",
  ): Port[] {
    const [first, ...rest] = branches;
    if (!first) return ports;
    if (first.cond === null) return this.sequence(first.body, ports, loop);

    const label = `${first.keyword ?? keyword} ${first.cond}`.trimEnd();
    const cond = this.add("branch", label, first.line, first.endLine);
    this.connect(ports, cond);
    const thenPorts = this.sequence(first.body, [{ from: cond, label: "True" }], loop);
    const elsePorts = this.ifChain(rest, [{ from: cond, label: "False" }], loop, "elif");
    return [...thenPorts, ...elsePorts];
  }

  private loop(
    kind: "branch" | "loop",
    label: string,
    at: { line: number; endLine: number },
    ports: Port[],
    body: Stmt[],
    orelse: Stmt[],
    outer: Loop | null,
    labels: { enter: string; leave: string | null },
  ): Port[] {
    const head = this.add(kind, label, at.line, at.endLine);
    this.connect(ports, head);
    const inner: Loop = { head, back: true, breaks: [] };
    const bodyPorts = this.sequence(body, [{ from: head, label: labels.enter }], inner);
    this.connect(bodyPorts, head, true);
    const exitPorts: Port[] = labels.leave === null ? [] : [{ from: head, label: labels.leave }];
    const afterElse = orelse.length > 0 ? this.sequence(orelse, exitPorts, outer) : exitPorts;
    return [...afterElse, ...inner.breaks];
  }

  /** The condition comes after the body, which `continue` jumps forward to. */
  private doWhile(stmt: Extract<Stmt, { type: "do" }>, ports: Port[]): Port[] {
    const head = this.add("loop", "do", stmt.line);
    this.connect(ports, head);
    // The condition is created after the body so that nodes stay in source order.
    const cond: CfgNode = {
      id: `n${this.nextId++}`,
      kind: "branch",
      label: `while ${stmt.cond}`.trimEnd(),
      line: stmt.condLine,
      endLine: stmt.endLine,
    };
    const inner: Loop = { head: cond.id, back: false, breaks: [] };
    const bodyPorts = this.sequence(stmt.body, [{ from: head, label: "next" }], inner);
    this.nodes.push(cond);
    this.connect(bodyPorts, cond.id);
    this.connect([{ from: cond.id, label: "True" }], head, true);
    return [...(stmt.infinite ? [] : [{ from: cond.id, label: "False", jump: true }]), ...inner.breaks];
  }

  /**
   * Tests each `case` in turn like an `if` / `else if` chain. A body without `break` falls
   * through into the next one, and `default` is entered once every test has failed.
   */
  private switchCases(stmt: Extract<Stmt, { type: "switch" }>, ports: Port[], outer: Loop | null): Port[] {
    const head = this.add("block", stmt.head, stmt.line, stmt.endLine);
    this.connect(ports, head);
    let failed: Port[] = [{ from: head, label: null }];
    const tests = stmt.cases.map((c) => {
      if (c.label === null) return null;
      const test = this.add("branch", `case ${c.label}`, c.line, c.endLine);
      this.connect(failed, test);
      failed = [{ from: test, label: "False" }];
      return test;
    });
    const inner: Loop = { head: outer?.head ?? null, back: outer?.back ?? true, breaks: [] };
    let fallthrough: Port[] = [];
    stmt.cases.forEach((c, i) => {
      const test = tests[i];
      const entry = test ? [{ from: test, label: "True" }] : failed;
      fallthrough = this.sequence(c.body, [...fallthrough, ...entry], inner);
    });
    const hasDefault = tests.includes(null);
    return [...fallthrough, ...inner.breaks, ...(hasDefault ? [] : failed)];
  }

  private add(kind: CfgNodeKind, label: string, line: number, endLine = line): string {
    const id = `n${this.nextId++}`;
    this.nodes.push({ id, kind, label, line, endLine });
    return id;
  }

  private append(id: string, text: string, endLine: number) {
    const node = this.nodes.find((n) => n.id === id);
    if (!node) throw new Error(`Unknown node ${id}`);
    node.label = `${node.label}\n${text}`;
    node.endLine = endLine;
  }

  private connect(ports: Port[], target: string, back = false) {
    for (const port of ports) {
      this.edges.push({ source: port.from, target, label: port.label, back, jump: port.jump ?? false });
    }
  }

  private report(line: number, message: string) {
    this.diagnostics.push({ line, message, severity: "error" });
  }
}
