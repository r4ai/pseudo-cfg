/**
 * Bundles the `pseudo-cfg` CLI into a standalone executable at `dist/cli.js`.
 */
import { execFile } from "node:child_process";
import { chmod } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const rolldownBin = resolve("node_modules/.bin/rolldown");
const outFile = resolve("dist/cli.js");

await execFileAsync(rolldownBin, [
  "src/cli/bin.ts",
  "--file",
  outFile,
  "--format",
  "esm",
  "--platform",
  "node",
  "--tsconfig",
  "tsconfig.json",
  "--banner",
  "#!/usr/bin/env node",
  "--logLevel",
  "warn",
]);

await chmod(outFile, 0o755);
console.warn("Built dist/cli.js");
