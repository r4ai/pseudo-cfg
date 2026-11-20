export type YamlValue = string | number | boolean | null | YamlValue[] | { [key: string]: YamlValue };

type Line = {
  no: number;
  indent: number;
  raw: string;
  text: string;
};

/**
 * Zero-dependency YAML 1.2 subset parser covering block mappings, block sequences,
 * literal/folded block scalars (`|`, `|-`, `|+`, `>`, `>-`), flow sequences/mappings,
 * quoted strings, numbers, booleans, null, and comments.
 */
export function parseYaml(input: string): YamlValue {
  const rawLines = input.replace(/\r\n/g, "\n").split("\n");
  const lines: Line[] = rawLines.map((raw, idx) => {
    const indent = countIndent(raw);
    return { no: idx + 1, indent, raw, text: raw.slice(indent) };
  });

  const parser = new YamlParser(lines);
  parser.skipIgnorable();
  if (parser.eof()) return null;
  if (parser.current().text === "---" || parser.current().text.startsWith("--- ")) {
    parser.pos++;
    parser.skipIgnorable();
  }
  if (parser.eof()) return null;
  return parser.parseNode(parser.current().indent);
}

class YamlParser {
  pos = 0;
  readonly lines: Line[];

  constructor(lines: Line[]) {
    this.lines = lines;
  }

  eof(): boolean {
    return this.pos >= this.lines.length;
  }

  current(): Line {
    return this.lines[this.pos] as Line;
  }

  skipIgnorable(): void {
    while (!this.eof()) {
      const line = this.current();
      const trimmed = line.text.trim();
      if (trimmed === "" || trimmed.startsWith("#")) {
        this.pos++;
        continue;
      }
      if (trimmed === "...") {
        this.pos = this.lines.length;
        return;
      }
      break;
    }
  }

  parseNode(minIndent: number): YamlValue {
    this.skipIgnorable();
    if (this.eof()) return null;
    const line = this.current();
    if (line.indent < minIndent) return null;

    if (isSequenceLine(line.text)) {
      return this.parseSequence(line.indent);
    }
    if (findMappingColon(line.text) >= 0) {
      return this.parseMapping(line.indent);
    }
    this.pos++;
    return parseInlineValue(stripComment(line.text), line.no);
  }

  private parseSequence(indent: number): YamlValue[] {
    const out: YamlValue[] = [];
    while (!this.eof()) {
      this.skipIgnorable();
      if (this.eof()) break;
      const line = this.current();
      if (line.indent < indent) break;
      if (line.indent > indent) {
        throw yamlError(line.no, `Unexpected indentation (${line.indent}, expected ${indent}) in sequence.`);
      }
      if (!isSequenceLine(line.text)) break;

      const afterDash = line.text.slice(1);
      const restTrimmed = afterDash.trim();
      this.pos++;

      if (restTrimmed === "" || restTrimmed.startsWith("#")) {
        this.skipIgnorable();
        if (this.eof() || this.current().indent <= indent) {
          out.push(null);
        } else {
          out.push(this.parseNode(this.current().indent));
        }
        continue;
      }

      const itemIndent = indent + 1 + countLeadingSpaces(afterDash);
      const itemText = afterDash.trimStart();

      if (isBlockScalarHeader(stripComment(itemText))) {
        out.push(this.parseBlockScalar(stripComment(itemText), indent));
        continue;
      }

      if (isSequenceLine(itemText)) {
        this.lines.splice(this.pos, 0, {
          no: line.no,
          indent: itemIndent,
          raw: " ".repeat(itemIndent) + itemText,
          text: itemText,
        });
        out.push(this.parseSequence(itemIndent));
        continue;
      }

      if (findMappingColon(itemText) >= 0) {
        const obj: Record<string, YamlValue> = {};
        this.parseMappingEntry(obj, itemText, line.no, itemIndent);
        while (!this.eof()) {
          this.skipIgnorable();
          if (this.eof()) break;
          const next = this.current();
          if (next.indent < itemIndent) break;
          if (next.indent > itemIndent) {
            throw yamlError(
              next.no,
              `Unexpected indentation (${next.indent}, expected ${itemIndent}) in sequence object.`,
            );
          }
          if (isSequenceLine(next.text)) break;
          this.pos++;
          this.parseMappingEntry(obj, next.text, next.no, itemIndent);
        }
        out.push(obj);
        continue;
      }

      out.push(parseInlineValue(stripComment(itemText), line.no));
    }
    return out;
  }

  private parseMapping(indent: number): Record<string, YamlValue> {
    const out: Record<string, YamlValue> = {};
    while (!this.eof()) {
      this.skipIgnorable();
      if (this.eof()) break;
      const line = this.current();
      if (line.indent < indent) break;
      if (line.indent > indent) {
        throw yamlError(line.no, `Unexpected indentation (${line.indent}, expected ${indent}) in mapping.`);
      }
      if (isSequenceLine(line.text)) break;
      this.pos++;
      this.parseMappingEntry(out, line.text, line.no, indent);
    }
    return out;
  }

  private parseMappingEntry(
    target: Record<string, YamlValue>,
    text: string,
    lineNo: number,
    entryIndent: number,
  ): void {
    const colon = findMappingColon(text);
    if (colon < 0) {
      throw yamlError(lineNo, `Expected 'key: value' mapping entry, got '${text}'.`);
    }
    const rawKey = text.slice(0, colon).trim();
    const key = parseKey(rawKey, lineNo);
    const rawRest = text.slice(colon + 1).trim();

    if (rawRest === "" || rawRest.startsWith("#")) {
      this.skipIgnorable();
      if (this.eof()) {
        target[key] = null;
        return;
      }
      const next = this.current();
      if (next.indent > entryIndent || (next.indent === entryIndent && isSequenceLine(next.text))) {
        target[key] = this.parseNode(next.indent);
      } else {
        target[key] = null;
      }
      return;
    }

    const cleaned = stripComment(rawRest);
    if (isBlockScalarHeader(cleaned)) {
      target[key] = this.parseBlockScalar(cleaned, entryIndent);
      return;
    }

    target[key] = parseInlineValue(cleaned, lineNo);
  }

  private parseBlockScalar(header: string, parentIndent: number): string {
    const style = header[0] as "|" | ">";
    const rest = header.slice(1);
    const chomp: "clip" | "strip" | "keep" = rest.includes("-")
      ? "strip"
      : rest.includes("+")
        ? "keep"
        : "clip";
    const explicitDigit = /[1-9]/.exec(rest);
    const explicitIndent = explicitDigit ? parentIndent + Number(explicitDigit[0]) : null;

    const collected: string[] = [];
    let blockIndent = explicitIndent;

    while (!this.eof()) {
      const line = this.current();
      const blank = line.raw.trim() === "";
      if (blank) {
        collected.push("");
        this.pos++;
        continue;
      }
      if (blockIndent === null) {
        if (line.indent <= parentIndent) break;
        blockIndent = line.indent;
      }
      if (line.indent < blockIndent) break;
      collected.push(line.raw.slice(blockIndent));
      this.pos++;
    }

    let trailingBlanks = 0;
    while (collected.length > 0 && collected.at(-1) === "") {
      collected.pop();
      trailingBlanks++;
    }

    let body: string;
    if (style === "|") {
      body = collected.join("\n");
    } else {
      const parts: string[] = [];
      for (let i = 0; i < collected.length; i++) {
        const cur = collected[i] as string;
        if (i === 0) {
          parts.push(cur);
          continue;
        }
        const prev = collected[i - 1] as string;
        if (cur === "" || prev === "" || cur.startsWith(" ") || prev.startsWith(" ")) {
          parts.push(`\n${cur}`);
        } else {
          parts.push(` ${cur}`);
        }
      }
      body = parts.join("");
    }

    if (body === "" && chomp !== "keep") return "";
    if (chomp === "strip") return body;
    if (chomp === "keep") return `${body}${"\n".repeat(trailingBlanks + 1)}`;
    return `${body}\n`;
  }
}

function isSequenceLine(text: string): boolean {
  return text === "-" || text.startsWith("- ") || text.startsWith("-\t");
}

function isBlockScalarHeader(text: string): boolean {
  return /^[|>][+-]?[1-9]?$/.test(text) || /^[|>][1-9]?[+-]?$/.test(text);
}

function findMappingColon(text: string): number {
  let quote: '"' | "'" | null = null;
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (quote === '"') {
      if (ch === "\\") i++;
      else if (ch === '"') quote = null;
      continue;
    }
    if (quote === "'") {
      if (ch === "'" && text[i + 1] === "'") i++;
      else if (ch === "'") quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === "[" || ch === "{") depth++;
    else if (ch === "]" || ch === "}") depth = Math.max(0, depth - 1);
    else if (ch === "#" && (i === 0 || text[i - 1] === " " || text[i - 1] === "\t")) break;
    else if (ch === ":" && depth === 0) {
      const next = text[i + 1];
      if (next === undefined || next === " " || next === "\t") return i;
    }
  }
  return -1;
}

function stripComment(text: string): string {
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (quote === '"') {
      if (ch === "\\") i++;
      else if (ch === '"') quote = null;
      continue;
    }
    if (quote === "'") {
      if (ch === "'" && text[i + 1] === "'") i++;
      else if (ch === "'") quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "#" && (i === 0 || text[i - 1] === " " || text[i - 1] === "\t")) {
      return text.slice(0, i).trimEnd();
    }
  }
  return text.trimEnd();
}

function parseKey(raw: string, lineNo: number): string {
  if (raw.startsWith('"') || raw.startsWith("'")) {
    return parseQuotedString(raw, lineNo);
  }
  if (raw === "") throw yamlError(lineNo, "Empty mapping key.");
  return raw;
}

function parseInlineValue(raw: string, lineNo: number): YamlValue {
  const s = raw.trim();
  if (s === "" || s === "null" || s === "~") return null;
  if (s === "true") return true;
  if (s === "false") return false;
  if (s.startsWith('"') || s.startsWith("'")) return parseQuotedString(s, lineNo);
  if (s.startsWith("[")) return parseFlowSequence(s, lineNo);
  if (s.startsWith("{")) return parseFlowMapping(s, lineNo);
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(s)) return Number(s);
  return s;
}

function parseQuotedString(raw: string, lineNo: number): string {
  const quote = raw[0] as '"' | "'";
  if (raw.length < 2 || raw.at(-1) !== quote) {
    throw yamlError(lineNo, `Unterminated ${quote === '"' ? "double" : "single"}-quoted string.`);
  }
  const inner = raw.slice(1, -1);
  if (quote === "'") return inner.replaceAll("''", "'");
  try {
    return JSON.parse(raw) as string;
  } catch {
    throw yamlError(lineNo, `Invalid escape sequence in double-quoted string: ${raw}`);
  }
}

function parseFlowSequence(raw: string, lineNo: number): YamlValue[] {
  if (!raw.endsWith("]")) throw yamlError(lineNo, "Unterminated flow sequence '['.");
  const inner = raw.slice(1, -1).trim();
  if (inner === "") return [];
  return splitFlowItems(inner, lineNo).map((item) => parseInlineValue(item, lineNo));
}

function parseFlowMapping(raw: string, lineNo: number): Record<string, YamlValue> {
  if (!raw.endsWith("}")) throw yamlError(lineNo, "Unterminated flow mapping '{'.");
  const inner = raw.slice(1, -1).trim();
  const out: Record<string, YamlValue> = {};
  if (inner === "") return out;
  for (const part of splitFlowItems(inner, lineNo)) {
    const colon = findMappingColon(part);
    if (colon < 0) throw yamlError(lineNo, `Expected 'key: value' inside flow mapping, got '${part}'.`);
    const key = parseKey(part.slice(0, colon).trim(), lineNo);
    const val = parseInlineValue(part.slice(colon + 1), lineNo);
    out[key] = val;
  }
  return out;
}

function splitFlowItems(inner: string, lineNo: number): string[] {
  const items: string[] = [];
  let start = 0;
  let depth = 0;
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i] as string;
    if (quote === '"') {
      if (ch === "\\") i++;
      else if (ch === '"') quote = null;
      continue;
    }
    if (quote === "'") {
      if (ch === "'" && inner[i + 1] === "'") i++;
      else if (ch === "'") quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "[" || ch === "{") depth++;
    else if (ch === "]" || ch === "}") depth--;
    else if (ch === "," && depth === 0) {
      items.push(inner.slice(start, i).trim());
      start = i + 1;
    }
  }
  if (depth !== 0 || quote !== null) {
    throw yamlError(lineNo, "Unbalanced brackets or quotes in flow collection.");
  }
  const tail = inner.slice(start).trim();
  if (tail !== "") items.push(tail);
  return items;
}

function countIndent(raw: string): number {
  let i = 0;
  while (i < raw.length && raw[i] === " ") i++;
  return i;
}

function countLeadingSpaces(s: string): number {
  let i = 0;
  while (i < s.length && s[i] === " ") i++;
  return i;
}

function yamlError(lineNo: number, message: string): Error {
  return new Error(`YAML error on line ${lineNo}: ${message}`);
}

/** Formats a string safely as a YAML key or scalar. */
export function yamlScalar(value: string): string {
  if (/^[A-Za-z0-9_.-]+$/.test(value) && value !== "true" && value !== "false" && value !== "null") {
    return value;
  }
  return JSON.stringify(value);
}

/** Formats a multiline source string as a YAML literal block scalar (`|`). */
export function yamlBlockString(value: string, indent = 2): string {
  const pad = " ".repeat(indent);
  const trimmed = value.endsWith("\n") ? value.slice(0, -1) : value;
  const header = value.endsWith("\n") ? "|" : "|-";
  if (trimmed === "") return `${header}\n`;
  const body = trimmed
    .split("\n")
    .map((line) => (line === "" ? "" : `${pad}${line}`))
    .join("\n");
  return `${header}\n${body}`;
}
