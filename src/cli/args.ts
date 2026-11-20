export type OptionSpec = {
  type: "boolean" | "string" | "number";
  short?: string;
};

export type OptionSchema = Record<string, OptionSpec>;

type ValueType<S extends OptionSpec> = S["type"] extends "boolean"
  ? boolean
  : S["type"] extends "number"
    ? number
    : string;

export type ParsedArgs<T extends OptionSchema> = {
  positionals: string[];
  values: { [K in keyof T]?: ValueType<T[K]> };
};

export class CliError extends Error {
  readonly code: number;

  constructor(message: string, code = 1) {
    super(message);
    this.name = "CliError";
    this.code = code;
  }
}

const NEGATIVE_NUMBER = /^-(?:\d+\.?\d*|\.\d+)$/;

/**
 * Parses CLI argv against a schema. Unlike `node:util`'s `parseArgs`, negative
 * numbers (e.g. `-40`, `-12.5`) are treated as values rather than unknown flags.
 */
export function parseCliArgs<T extends OptionSchema>(argv: string[], schema: T): ParsedArgs<T> {
  const byShort = new Map<string, string>();
  for (const [name, spec] of Object.entries(schema)) {
    if (spec.short) byShort.set(spec.short, name);
  }

  const positionals: string[] = [];
  const values: Record<string, boolean | string | number> = {};

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i] as string;
    if (token === "--") {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (token === "-" || !token.startsWith("-") || NEGATIVE_NUMBER.test(token)) {
      positionals.push(token);
      continue;
    }

    if (token.startsWith("--")) {
      const eq = token.indexOf("=");
      const rawName = eq >= 0 ? token.slice(2, eq) : token.slice(2);
      const spec = schema[rawName];
      if (!spec) {
        throw new CliError(`Unknown option '--${rawName}'. Run with --help to see valid options.`);
      }
      if (spec.type === "boolean") {
        if (eq >= 0) {
          const inline = token.slice(eq + 1);
          if (inline === "true" || inline === "1") values[rawName] = true;
          else if (inline === "false" || inline === "0") values[rawName] = false;
          else throw new CliError(`Option '--${rawName}' does not accept value '${inline}'.`);
        } else {
          values[rawName] = true;
        }
        continue;
      }
      const rawValue = eq >= 0 ? token.slice(eq + 1) : argv[++i];
      if (rawValue === undefined) {
        throw new CliError(`Option '--${rawName}' requires a value.`);
      }
      values[rawName] = parseValue(rawName, rawValue, spec.type);
      continue;
    }

    // Short option (e.g. -o value, -h, -o=value)
    const shortFlag = token.slice(1);
    const eq = shortFlag.indexOf("=");
    const key = eq >= 0 ? shortFlag.slice(0, eq) : shortFlag;
    const name = byShort.get(key);
    if (!name) {
      throw new CliError(`Unknown option '-${key}'. Run with --help to see valid options.`);
    }
    const spec = schema[name] as OptionSpec;
    if (spec.type === "boolean") {
      if (eq >= 0) throw new CliError(`Option '-${key}' does not take a value.`);
      values[name] = true;
      continue;
    }
    const rawValue = eq >= 0 ? shortFlag.slice(eq + 1) : argv[++i];
    if (rawValue === undefined) {
      throw new CliError(`Option '-${key}' (--${name}) requires a value.`);
    }
    values[name] = parseValue(name, rawValue, spec.type);
  }

  return { positionals, values: values as ParsedArgs<T>["values"] };
}

function parseValue(name: string, raw: string, type: "string" | "number"): string | number {
  if (type === "string") return raw;
  const num = Number(raw);
  if (!Number.isFinite(num)) {
    throw new CliError(`Option '--${name}' expects a finite number, got '${raw}'.`);
  }
  return num;
}

export function parseNumberArg(label: string, raw: string): number {
  const num = Number(raw);
  if (!Number.isFinite(num)) {
    throw new CliError(`Expected a finite number for ${label}, got '${raw}'.`);
  }
  return num;
}

export function parseIntegerArg(label: string, raw: string): number {
  const num = Number(raw);
  if (!Number.isInteger(num)) {
    throw new CliError(`Expected an integer for ${label}, got '${raw}'.`);
  }
  return num;
}
