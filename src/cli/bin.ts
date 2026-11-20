import { runCli } from "./run";

const exitCode = await runCli(process.argv.slice(2));
process.exitCode = exitCode;
