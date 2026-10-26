/**
 * Parser for CUDA- and C-like pseudocode, the brace-delimited counterpart of `parse`.
 *
 * Like `parse` it is forgiving: whatever is not a recognised control-flow construct
 * becomes a plain statement, so arbitrary pseudocode still produces a graph.
 */

import type { Diagnostic, IfBranch, Program, Stmt, SwitchCase } from "./parse";

type Token = { text: string; line: number; start: number; end: number; string: boolean };

export function parseCuda(source: string): Program {
  const diagnostics: Diagnostic[] = [];
  const parser = new Parser(tokenize(source, diagnostics), diagnostics);
  const body = parser.items("namespace");
  // C runs no code outside functions, so top-level declarations are left out of the graph
  // once there are functions to show; top-level snippets without functions still work.
  const hasDefs = body.some((stmt) => stmt.type === "def");
  return { body: hasDefs ? body.filter((stmt) => stmt.type !== "simple") : body, diagnostics };
}

/** Splits the source into tokens, dropping comments and preprocessor directives. */
function tokenize(source: string, diagnostics: Diagnostic[]): Token[] {
  const tokens: Token[] = [];
  let line = 1;
  let lineStart = true;
  const push = (start: number, end: number, string = false) =>
    tokens.push({ text: source.slice(start, end), line, start, end, string });

  for (let i = 0; i < source.length;) {
    const ch = source[i] as string;
    if (ch === "\n") {
      line++;
      lineStart = true;
      i++;
    } else if (/\s/.test(ch)) {
      i++;
    } else if (source.startsWith("//", i)) {
      i = lineEnd(source, i);
    } else if (source.startsWith("/*", i)) {
      const close = source.indexOf("*/", i + 2);
      if (close < 0) diagnostics.push({ line, message: "Unterminated comment", severity: "error" });
      const end = close < 0 ? source.length : close + 2;
      line += newlines(source, i, end);
      i = end;
    } else if (ch === "#" && lineStart) {
      // `#include`, `#define`, `#pragma unroll`, ...: none of them is control flow.
      let end = lineEnd(source, i);
      while (source[end - 1] === "\\" && end < source.length) end = lineEnd(source, end + 1);
      line += newlines(source, i, end);
      i = end;
    } else if (ch === '"' || ch === "'") {
      // An unterminated literal ends with its line, so it cannot swallow the rest of the file.
      let end = i + 1;
      while (end < source.length && source[end] !== ch && source[end] !== "\n") {
        end += source[end] === "\\" ? 2 : 1;
      }
      end = Math.min(source[end] === ch ? end + 1 : end, source.length);
      push(i, end, true);
      line += newlines(source, i, end);
      i = end;
      lineStart = false;
    } else {
      const word = /^[\p{L}\p{N}_$]+/u.exec(source.slice(i, i + 256))?.[0];
      const end = i + (word?.length ?? 1);
      push(i, end);
      i = end;
      lineStart = false;
    }
  }
  return tokens;
}

function lineEnd(source: string, from: number): number {
  const end = source.indexOf("\n", from);
  return end < 0 ? source.length : end;
}

function newlines(source: string, from: number, to: number): number {
  let count = 0;
  for (let i = from; i < to; i++) if (source[i] === "\n") count++;
  return count;
}

/** Joins tokens back into text, with one space wherever the source had whitespace or a comment. */
function textOf(tokens: Token[]): string {
  return tokens
    .map((t, i) => (i > 0 && t.start > (tokens[i - 1] as Token).end ? ` ${t.text}` : t.text))
    .join("");
}

const OPEN = new Set(["(", "[", "{"]);
const CLOSE = new Set([")", "]", "}"]);
const TYPE_KEYWORDS = new Set(["struct", "class", "union", "enum"]);
/** `while (true)`, `while (1)` and `for (;;)` have no way out but `break` or `return`. */
const ALWAYS_TRUE = /^\(\s*(?:true|1)\s*\)$/;

const APPROXIMATE_TRY = "'try' is approximated: each 'catch' is shown as a branch that may be taken";

/** Where a statement sits: function definitions are only recognised outside function bodies. */
type Scope = "namespace" | "body";

class Parser {
  private index = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly diagnostics: Diagnostic[],
  ) {}

  /** Parses statements up to the end of the input or a closing `}`, which is left unread. */
  items(scope: Scope): Stmt[] {
    const stmts: Stmt[] = [];
    for (let token = this.peek(); token && !this.at("}"); token = this.peek()) {
      stmts.push(...this.statement(scope));
    }
    return stmts;
  }

  private statement(scope: Scope): Stmt[] {
    const token = this.peek() as Token;
    if (token.string) return this.plain(scope);
    switch (token.text) {
      case ";":
        this.index++;
        return [];
      case "{":
        return this.braced(scope);
      case "if":
        return [this.ifStatement()];
      case "while": {
        this.index++;
        const cond = this.condition(token);
        return [
          {
            type: "while",
            cond: cond.text,
            line: token.line,
            endLine: cond.endLine,
            body: this.body(token),
            orelse: [],
            infinite: ALWAYS_TRUE.test(cond.text),
          },
        ];
      }
      case "for": {
        this.index++;
        const head = this.condition(token);
        const clauses = head.text.slice(1, -1).split(";");
        return [
          {
            type: "for",
            head: head.text,
            line: token.line,
            endLine: head.endLine,
            body: this.body(token),
            orelse: [],
            infinite: clauses.length === 3 && clauses[1]?.trim() === "",
          },
        ];
      }
      case "do":
        return [this.doWhile(token)];
      case "switch":
        return [this.switchStatement(token)];
      case "try":
        return this.tryStatement(token);
      case "else":
      case "catch":
        this.index++;
        this.report(
          token.line,
          `'${token.text}' without a matching '${token.text === "else" ? "if" : "try"}'`,
        );
        if (token.text === "catch") this.condition(token);
        this.body(token);
        return [];
      case "case":
      case "default":
        this.caseLabel();
        this.report(token.line, `'${token.text}' outside 'switch'`);
        return [];
      default:
        return this.plain(scope);
    }
  }

  /** A `{ ... }` block; its statements run in sequence with those around it. */
  private braced(scope: Scope): Stmt[] {
    const open = this.next() as Token;
    const body = this.items(scope);
    this.close(open);
    return body;
  }

  private ifStatement(): Stmt {
    const branches: IfBranch[] = [];
    let keyword = "if";
    for (;;) {
      const token = this.next() as Token;
      const cond = this.condition(token);
      branches.push({
        keyword,
        cond: cond.text,
        line: token.line,
        endLine: cond.endLine,
        body: this.body(token),
      });
      const elseToken = this.peek();
      if (elseToken?.text !== "else") break;
      this.index++;
      if (this.peek()?.text !== "if") {
        branches.push({
          cond: null,
          line: elseToken.line,
          endLine: elseToken.line,
          body: this.body(elseToken),
        });
        break;
      }
      keyword = "else if";
    }
    return { type: "if", branches };
  }

  private doWhile(token: Token): Stmt {
    this.index++;
    const body = this.body(token);
    const whileToken = this.peek();
    if (whileToken?.text !== "while") {
      this.report(token.line, "Expected 'while' after the body of 'do'");
      return {
        type: "do",
        cond: "",
        line: token.line,
        condLine: token.line,
        endLine: token.line,
        body,
        infinite: true,
      };
    }
    this.index++;
    const cond = this.condition(whileToken);
    this.semicolon(cond.endLine);
    return {
      type: "do",
      cond: cond.text,
      line: token.line,
      condLine: whileToken.line,
      endLine: cond.endLine,
      body,
      infinite: ALWAYS_TRUE.test(cond.text),
    };
  }

  private switchStatement(token: Token): Stmt {
    this.index++;
    const subject = this.condition(token);
    const stmt = {
      type: "switch" as const,
      head: `switch ${subject.text}`.trimEnd(),
      line: token.line,
      endLine: subject.endLine,
      cases: [] as SwitchCase[],
    };
    const open = this.peek();
    if (open?.text !== "{") {
      this.report(token.line, "Expected '{' after 'switch'");
      return stmt;
    }
    this.index++;
    for (let next = this.peek(); next && next.text !== "}"; next = this.peek()) {
      if (next.text === "case" || next.text === "default") {
        const label = this.caseLabel();
        stmt.cases.push({ label, line: next.line, endLine: this.previousLine(), body: [] });
        continue;
      }
      const body = this.statement("body");
      const current = stmt.cases.at(-1);
      if (current) current.body.push(...body);
      else if (body.length > 0) this.report(next.line, "Code before the first 'case' never runs", "warning");
    }
    this.close(open);
    return stmt;
  }

  /** Reads `case X:` or `default:`, returning `X` or null for `default`. */
  private caseLabel(): string | null {
    const keyword = this.next() as Token;
    const tokens: Token[] = [];
    let depth = 0;
    for (let token = this.peek(); token; token = this.peek()) {
      if (depth === 0 && token.text === ":" && !token.string) {
        // `::` in `case Color::Red:` is two adjacent colons, not the end of the label.
        const after = this.tokens[this.index + 1];
        if (!(after?.text === ":" && after.start === token.end)) break;
        tokens.push(token, after);
        this.index += 2;
        continue;
      }
      if (depth === 0 && (token.text === "{" || token.text === "}" || token.text === ";")) break;
      if (!token.string && OPEN.has(token.text)) depth++;
      else if (!token.string && CLOSE.has(token.text)) depth--;
      tokens.push(token);
      this.index++;
    }
    if (this.peek()?.text === ":") this.index++;
    else this.report(keyword.line, `Expected ':' after '${keyword.text}'`);
    return keyword.text === "default" ? null : textOf(tokens);
  }

  private tryStatement(token: Token): Stmt[] {
    this.index++;
    this.report(token.line, APPROXIMATE_TRY, "warning");
    const stmts: Stmt[] = [{ type: "simple", text: "try", line: token.line, endLine: token.line }];
    stmts.push(...this.body(token));
    for (let next = this.peek(); next?.text === "catch"; next = this.peek()) {
      this.index++;
      const cond = this.condition(next);
      const branch = { keyword: "catch", cond: cond.text, line: next.line, endLine: cond.endLine };
      stmts.push({ type: "if", branches: [{ ...branch, body: this.body(next) }] });
    }
    return stmts;
  }

  /** Reads a parenthesised condition or loop head, keeping its parentheses. */
  private condition(keyword: Token): { text: string; endLine: number } {
    if (this.peek()?.text !== "(") {
      this.report(keyword.line, `Expected '(' after '${keyword.text}'`);
      return { text: "", endLine: keyword.line };
    }
    const tokens = this.balanced();
    return { text: textOf(tokens), endLine: tokens.at(-1)?.line ?? keyword.line };
  }

  /** The statement controlled by `keyword`, such as the body of a loop. */
  private body(keyword: Token): Stmt[] {
    if (!this.peek() || this.at("}")) {
      this.report(keyword.line, `Expected a statement after '${keyword.text}'`);
      return [];
    }
    return this.statement("body");
  }

  /**
   * Any other statement, up to its `;`. Outside function bodies, a `{` that follows a
   * parameter list opens a function definition.
   */
  private plain(scope: Scope): Stmt[] {
    const tokens: Token[] = [];
    for (let token = this.peek(); token; token = this.peek()) {
      if (token.string) {
        tokens.push(token);
        this.index++;
      } else if (token.text === ";" || token.text === "}") {
        break;
      } else if (token.text === "{") {
        if (scope === "namespace" && tokens.length > 0) {
          const block = this.declarationBlock(tokens);
          if (block) return block;
        }
        // An initializer list or a lambda body is part of the expression.
        tokens.push(...this.balanced());
      } else if (OPEN.has(token.text)) {
        tokens.push(...this.balanced());
      } else {
        tokens.push(token);
        this.index++;
      }
    }
    const first = tokens[0] as Token;
    const last = tokens.at(-1) as Token;
    this.semicolon(last.line);
    return [simpleStatement(textOf(tokens), first.line, last.line)];
  }

  /**
   * Handles a `{` at namespace scope after `header`: a function body, a namespace, or a
   * type definition. Returns null when the braces belong to an expression (`int a[] = {1, 2};`).
   */
  private declarationBlock(header: Token[]): Stmt[] | null {
    const words = header.filter((t) => !t.string).map((t) => t.text);
    const first = header[0] as Token;
    if (words[0] === "namespace" || (words[0] === "extern" && header.length === 2 && header[1]?.string)) {
      return this.braced("namespace");
    }
    if (words.includes("=")) return null;
    if (words.some((word) => TYPE_KEYWORDS.has(word))) {
      // Type definitions declare rather than run; skip them through their closing `;`.
      this.balanced();
      while (this.peek() && !this.at(";") && !this.at("}")) this.index++;
      this.semicolon(this.previousLine());
      return [];
    }
    if (!words.includes("(")) return null;
    const open = this.next() as Token;
    const body = this.items("body");
    this.close(open);
    const last = header.at(-1) as Token;
    return [{ type: "def", header: textOf(header), line: first.line, endLine: last.line, body }];
  }

  /** Reads a bracketed group, including nested ones, from its opening bracket. */
  private balanced(): Token[] {
    const open = this.next() as Token;
    const tokens = [open];
    const expected: string[] = [closing(open.text)];
    for (let token = this.peek(); token && expected.length > 0; token = this.peek()) {
      if (!token.string && OPEN.has(token.text)) expected.push(closing(token.text));
      else if (!token.string && CLOSE.has(token.text)) {
        if (token.text !== expected.at(-1)) break;
        expected.pop();
      }
      tokens.push(token);
      this.index++;
    }
    if (expected.length > 0) this.report(open.line, `'${open.text}' was never closed`);
    return tokens;
  }

  private close(open: Token) {
    if (this.at("}")) this.index++;
    else this.report(open.line, "'{' was never closed");
  }

  private semicolon(line: number) {
    if (this.at(";")) this.index++;
    else this.report(line, "Expected ';'");
  }

  private at(text: string): boolean {
    const token = this.peek();
    return token !== undefined && !token.string && token.text === text;
  }

  private peek(): Token | undefined {
    return this.tokens[this.index];
  }

  private next(): Token | undefined {
    return this.tokens[this.index++];
  }

  private previousLine(): number {
    return this.tokens[this.index - 1]?.line ?? 1;
  }

  private report(line: number, message: string, severity: Diagnostic["severity"] = "error") {
    this.diagnostics.push({ line, message, severity });
  }
}

function closing(open: string): string {
  return open === "(" ? ")" : open === "[" ? "]" : "}";
}

function simpleStatement(text: string, line: number, endLine: number): Stmt {
  const keyword = /^[\p{L}\p{N}_]+/u.exec(text)?.[0];
  if (keyword === "break" || keyword === "continue") return { type: keyword, line };
  if (keyword === "return" || keyword === "throw") {
    return { type: "return", text, line, endLine, raises: keyword === "throw" };
  }
  return { type: "simple", text, line, endLine };
}
