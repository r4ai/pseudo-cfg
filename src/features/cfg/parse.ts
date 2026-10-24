/**
 * Indentation-based parser for Python-like pseudocode.
 *
 * It is deliberately forgiving: anything that is not a recognised control-flow
 * construct becomes a plain statement, so arbitrary pseudocode still produces a graph.
 */

/** Errors are code the parser could not make sense of; warnings are code it shows only approximately. */
export type Diagnostic = { line: number; message: string; severity: "error" | "warning" };

export type Stmt =
  | { type: "simple"; text: string; line: number; endLine: number }
  | { type: "return"; text: string; line: number; endLine: number; raises: boolean }
  | { type: "break" | "continue"; line: number }
  | { type: "if"; branches: IfBranch[] }
  | { type: "while"; cond: string; line: number; endLine: number; body: Stmt[]; orelse: Stmt[] }
  | { type: "for"; head: string; line: number; endLine: number; body: Stmt[]; orelse: Stmt[] }
  | { type: "def"; signature: string; line: number; endLine: number; body: Stmt[] };

/** `cond` is `null` for the trailing `else` branch. */
/** `keyword` labels branches that stand in for other constructs, such as `except`. */
export type IfBranch = { cond: string | null; line: number; endLine: number; body: Stmt[]; keyword?: string };

export type Program = { body: Stmt[]; diagnostics: Diagnostic[] };

type Line = { text: string; indent: number; line: number; endLine: number };

const TAB_WIDTH = 4;

export function parse(source: string): Program {
  const diagnostics: Diagnostic[] = [];
  const lines = toLogicalLines(source);
  const parser = new Parser(lines, diagnostics);
  // The shallowest line is the top level, so an indented first line cannot hide the rest.
  const body = parser.block(Math.min(...lines.map((line) => line.indent)));
  return { body, diagnostics };
}

/**
 * Splits the source into logical lines: comments and blank lines are dropped,
 * and lines inside open brackets or after a trailing backslash are joined.
 */
function toLogicalLines(source: string): Line[] {
  const result: Line[] = [];
  const physical = source.split(/\r?\n/);
  let pending: Line | null = null;
  let depth = 0;
  let quote: string | null = null;

  physical.forEach((raw, index) => {
    const startsInString = quote !== null;
    const scanned = scanLine(raw, quote);
    const { code, depthDelta } = scanned;
    quote = scanned.quote;
    const lineNo = index + 1;
    if (pending) {
      // Lines inside a multi-line string keep their text; others are joined with a space.
      pending.text = startsInString ? `${pending.text}\n${code}` : `${pending.text} ${code.trim()}`.trim();
      pending.endLine = lineNo;
    } else if (code.trim() !== "") {
      pending = { text: code.trim(), indent: indentWidth(raw), line: lineNo, endLine: lineNo };
    }
    depth = Math.max(0, depth + depthDelta);
    const continues = quote !== null || depth > 0 || code.trimEnd().endsWith("\\");
    if (pending && !continues) {
      pending.text = pending.text.replace(/\\$/, "").trimEnd();
      result.push(pending);
      pending = null;
    } else if (pending) {
      pending.text = pending.text.replace(/\\$/, "");
    }
  });
  if (pending) result.push(pending);
  return result;
}

/**
 * Removes a trailing comment and reports the net bracket depth change, ignoring string contents.
 *
 * @param quote - The string delimiter open at the start of the line (only triple quotes span lines).
 * @returns The delimiter still open at the end of the line, if any.
 */
function scanLine(
  raw: string,
  quote: string | null,
): { code: string; depthDelta: number; quote: string | null } {
  let depthDelta = 0;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i] as string;
    if (quote) {
      if (ch === "\\") i++;
      else if (raw.startsWith(quote, i)) {
        i += quote.length - 1;
        quote = null;
      }
    } else if (ch === '"' || ch === "'") {
      quote = raw.startsWith(ch.repeat(3), i) ? ch.repeat(3) : ch;
      i += quote.length - 1;
    } else if (ch === "#") {
      return { code: raw.slice(0, i), depthDelta, quote };
    } else if (ch === "(" || ch === "[" || ch === "{") {
      depthDelta++;
    } else if (ch === ")" || ch === "]" || ch === "}") {
      depthDelta--;
    }
  }
  // An unterminated single-quoted string ends with its line, as in Python.
  return { code: raw, depthDelta, quote: quote && quote.length === 3 ? quote : null };
}

function indentWidth(raw: string): number {
  let width = 0;
  for (const ch of raw) {
    if (ch === " ") width++;
    else if (ch === "\t") width += TAB_WIDTH - (width % TAB_WIDTH);
    else break;
  }
  return width;
}

/** Index of the first `:` outside brackets and strings, or -1. */
function headerColon(text: string): number {
  let quote: string | null = null;
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    else if (ch === ":" && depth === 0) return i;
  }
  return -1;
}

/**
 * Block statements this model has no flow for. Their header is shown as a statement and
 * their body follows in sequence, except for `except` and `case`, which become branches
 * that may or may not be taken; `try` and `match` get a warning that this is approximate.
 */
const SEQUENTIAL_KEYWORDS = new Set(["with", "class", "async", "try", "except", "finally", "match", "case"]);
const OPTIONAL_KEYWORDS = new Set(["except", "case"]);
const APPROXIMATE: Record<string, string> = {
  try: "'try' is approximated: each 'except' is shown as a branch that may be taken",
  match: "'match' is approximated: each 'case' is shown as a branch that may be taken",
};

/** Leading identifier, so that `break2` or `return値` are not taken for keywords. */
const leadingWord = (text: string) => /^[\p{L}\p{N}_]+/u.exec(text)?.[0];

const COMPOUND_KEYWORDS = new Set(["if", "elif", "else", "while", "for", "def", ...SEQUENTIAL_KEYWORDS]);

type Header = { keyword: string; rest: string; inline: string | null };

/** Recognises `keyword rest:` (optionally followed by an inline body). */
function parseHeader(text: string): Header | null {
  const keyword = leadingWord(text);
  if (!keyword || !COMPOUND_KEYWORDS.has(keyword)) return null;
  const colon = headerColon(text);
  if (colon < 0) return null;
  const inline = text.slice(colon + 1).trim();
  return {
    keyword,
    rest: text.slice(keyword.length, colon).trim(),
    inline: inline === "" ? null : inline,
  };
}

class Parser {
  private index = 0;

  constructor(
    private readonly lines: Line[],
    private readonly diagnostics: Diagnostic[],
  ) {}

  /** Parses consecutive lines indented exactly `indent`. */
  block(indent: number): Stmt[] {
    const stmts: Stmt[] = [];
    for (let line = this.peek(); line && line.indent >= indent; line = this.peek()) {
      if (line.indent > indent) {
        this.report(line.line, "Unexpected indent");
        stmts.push(...this.block(line.indent));
        continue;
      }
      if (line.text.startsWith("@")) {
        // Decorators don't change the flow inside the function they decorate.
        this.index++;
        continue;
      }
      const header = parseHeader(line.text);
      if (header && SEQUENTIAL_KEYWORDS.has(header.keyword)) {
        stmts.push(...this.sequentialBlock(line, header));
        continue;
      }
      const stmt = this.statement(line);
      if (stmt) stmts.push(stmt);
    }
    return stmts;
  }

  private sequentialBlock(line: Line, header: Header): Stmt[] {
    this.index++;
    const warning = APPROXIMATE[header.keyword];
    if (warning) this.report(line.line, warning, "warning");
    if (OPTIONAL_KEYWORDS.has(header.keyword)) {
      const branch = { keyword: header.keyword, cond: header.rest, line: line.line, endLine: line.endLine };
      return [{ type: "if", branches: [{ ...branch, body: this.body(line, header) }] }];
    }
    const text = line.text.slice(0, line.text.length - (header.inline?.length ?? 0)).trimEnd();
    return [{ type: "simple", text, line: line.line, endLine: line.endLine }, ...this.body(line, header)];
  }

  private statement(line: Line): Stmt | null {
    this.index++;
    const header = parseHeader(line.text);
    if (!header) return simpleStatement(line);

    switch (header.keyword) {
      case "if":
        return this.ifStatement(line, header);
      case "while":
        return {
          type: "while",
          cond: header.rest,
          line: line.line,
          endLine: line.endLine,
          body: this.body(line, header),
          orelse: this.elseClause(line.indent),
        };
      case "for":
        return {
          type: "for",
          head: header.rest,
          line: line.line,
          endLine: line.endLine,
          body: this.body(line, header),
          orelse: this.elseClause(line.indent),
        };
      case "def":
        return {
          type: "def",
          signature: header.rest,
          line: line.line,
          endLine: line.endLine,
          body: this.body(line, header),
        };
      default:
        this.report(line.line, `'${header.keyword}' without a matching 'if'`);
        this.body(line, header);
        return null;
    }
  }

  private ifStatement(line: Line, header: Header): Stmt {
    const branches: IfBranch[] = [
      { cond: header.rest, line: line.line, endLine: line.endLine, body: this.body(line, header) },
    ];
    for (let next = this.peek(); next && next.indent === line.indent; next = this.peek()) {
      const clause = parseHeader(next.text);
      if (clause?.keyword !== "elif" && clause?.keyword !== "else") break;
      this.index++;
      branches.push({
        cond: clause.keyword === "elif" ? clause.rest : null,
        line: next.line,
        endLine: next.endLine,
        body: this.body(next, clause),
      });
      if (clause.keyword === "else") break;
    }
    return { type: "if", branches };
  }

  private elseClause(indent: number): Stmt[] {
    const next = this.peek();
    if (!next || next.indent !== indent) return [];
    const clause = parseHeader(next.text);
    if (clause?.keyword !== "else") return [];
    this.index++;
    return this.body(next, clause);
  }

  private body(line: Line, header: Header): Stmt[] {
    if (header.inline !== null) {
      const stmt = this.statementFromText({ ...line, text: header.inline });
      return stmt ? [stmt] : [];
    }
    const next = this.peek();
    if (!next || next.indent <= line.indent) {
      this.report(line.line, "Expected an indented block");
      return [];
    }
    return this.block(next.indent);
  }

  /** Parses an inline body such as the `return x` in `if a: return x`. */
  private statementFromText(line: Line): Stmt | null {
    if (parseHeader(line.text)) {
      this.report(line.line, "Compound statements cannot follow ':' on the same line");
      return null;
    }
    return simpleStatement(line);
  }

  private peek(): Line | undefined {
    return this.lines[this.index];
  }

  private report(line: number, message: string, severity: Diagnostic["severity"] = "error") {
    this.diagnostics.push({ line, message, severity });
  }
}

function simpleStatement(line: Line): Stmt {
  const keyword = leadingWord(line.text);
  if (keyword === "break" || keyword === "continue") {
    return { type: keyword, line: line.line };
  }
  if (keyword === "return" || keyword === "raise") {
    return {
      type: "return",
      text: line.text,
      line: line.line,
      endLine: line.endLine,
      raises: keyword === "raise",
    };
  }
  return { type: "simple", text: line.text, line: line.line, endLine: line.endLine };
}
