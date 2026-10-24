import type { Diagnostic, Stmt } from "./parse";
import { parse } from "./parse";

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
};

export type Cfg = { nodes: CfgNode[]; edges: CfgEdge[] };

export type Granularity = "block" | "statement";

export type BuildResult = { cfg: Cfg; diagnostics: Diagnostic[] };

/** A dangling control-flow exit waiting to be connected to the next node. */
type Port = { from: string; label: string | null };

type Loop = { head: string; breaks: Port[] };

/**
 * Builds one graph per scope (top-level code and every `def`).
 * Node ids are only unique within this result; see `reconcile` for stable ids.
 */
export function buildCfg(source: string, granularity: Granularity): BuildResult {
  const program = parse(source);
  const builder = new Builder(granularity, program.diagnostics);
  const hasTopLevelCode = program.body.some((stmt) => stmt.type !== "def");
  const hasDefs = program.body.length > 0 && !hasTopLevelCode;
  if (hasDefs) builder.collectDefs(program.body);
  else builder.scope("Start", "End", 1, program.body);
  builder.flushDefs();
  return { cfg: { nodes: builder.nodes, edges: builder.edges }, diagnostics: program.diagnostics };
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

  scope(startLabel: string, endLabel: string, line: number, body: Stmt[]) {
    const start = this.add("start", startLabel, line);
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
      this.scope(`def ${def.signature}`, "return", def.line, def.body);
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
        ports = [{ from: open, label: null }];
        if (stmt.type === "return") {
          this.connect(ports, this.exit);
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
        return this.loop("branch", `while ${stmt.cond}`, stmt.line, ports, stmt.body, stmt.orelse, loop, {
          enter: "True",
          leave: stmt.cond === "True" ? null : "False",
        });
      case "for":
        return this.loop("loop", `for ${stmt.head}`, stmt.line, ports, stmt.body, stmt.orelse, loop, {
          enter: "next",
          leave: "done",
        });
      case "break":
        if (loop) loop.breaks.push(...ports);
        else this.report(stmt.line, "'break' outside loop");
        return loop ? [] : ports;
      case "continue":
        if (loop) this.connect(ports, loop.head, true);
        else this.report(stmt.line, "'continue' outside loop");
        return loop ? [] : ports;
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

    const cond = this.add("branch", `${keyword} ${first.cond}`, first.line);
    this.connect(ports, cond);
    const thenPorts = this.sequence(first.body, [{ from: cond, label: "True" }], loop);
    const elsePorts = this.ifChain(rest, [{ from: cond, label: "False" }], loop, "elif");
    return [...thenPorts, ...elsePorts];
  }

  private loop(
    kind: "branch" | "loop",
    label: string,
    line: number,
    ports: Port[],
    body: Stmt[],
    orelse: Stmt[],
    outer: Loop | null,
    labels: { enter: string; leave: string | null },
  ): Port[] {
    const head = this.add(kind, label, line);
    this.connect(ports, head);
    const inner: Loop = { head, breaks: [] };
    const bodyPorts = this.sequence(body, [{ from: head, label: labels.enter }], inner);
    this.connect(bodyPorts, head, true);
    const exitPorts: Port[] = labels.leave === null ? [] : [{ from: head, label: labels.leave }];
    const afterElse = orelse.length > 0 ? this.sequence(orelse, exitPorts, outer) : exitPorts;
    return [...afterElse, ...inner.breaks];
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
    for (const port of ports) this.edges.push({ source: port.from, target, label: port.label, back });
  }

  private report(line: number, message: string) {
    this.diagnostics.push({ line, message });
  }
}
