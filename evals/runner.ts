/**
 * A/B Eval Harness for `pseudo-cfg`:
 * Compares Mode A (Imperative CLI) vs. Mode B (Declarative YAML) using live Claude Code runs,
 * supports multi-turn follow-up refinement evaluations (Turn 1 -> Turn 2),
 * grades every diagram objectively, and generates a side-by-side HTML Visual Gallery (`report.html`).
 *
 * Usage:
 *   node evals/runner.ts [--mode cli|yaml|both] [--task id1,id2] [--model sonnet] [--concurrency 4]
 *   node evals/runner.ts --from-run evals/results/ab-sonnet --followup --out evals/results/ab-sonnet-turn2
 */
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { buildAgentPrompt, buildFollowUpPrompt } from "./prompts.ts";
import {
  type EvalReportData,
  type FollowUpResult,
  formatTextSummary,
  generateHtmlGallery,
  summarizeByMode,
  type TrialResult,
} from "./report.ts";
import {
  COGNITIVE_LOAD_FOLLOWUP_PROMPT,
  computeFlowMetrics,
  EVAL_TASKS,
  type EvalMode,
  type EvalTask,
  gradeLayoutFollowUp,
  type InspectedDiagram,
} from "./tasks.ts";

const execFileAsync = promisify(execFile);

type RunnerOptions = {
  modes: EvalMode[];
  taskFilter: Set<string> | null;
  model: string;
  concurrency: number;
  timeoutMs: number;
  dryRun: boolean;
  outDir: string | null;
  followUpPrompt: string | null;
  fromRunDir: string | null;
};

type ClaudeJsonResponse = {
  is_error?: boolean;
  result?: string;
  num_turns?: number;
  duration_ms?: number;
  total_cost_usd?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
};

function parseArgs(argv: string[]): RunnerOptions {
  let modes: EvalMode[] = ["cli", "yaml"];
  let taskFilter: Set<string> | null = null;
  let model = "sonnet";
  let concurrency = 4;
  let timeoutMs = 180_000;
  let dryRun = false;
  let outDir: string | null = null;
  let followUpPrompt: string | null = null;
  let fromRunDir: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === "--help" || arg === "-h") {
      process.stdout.write(`Usage: node evals/runner.ts [options]

Options:
  --mode <cli|yaml|both>      Modes to evaluate (default: both)
  --task <id1,id2,...>        Comma-separated task IDs (default: all ${EVAL_TASKS.length} tasks)
  --model <name>              Claude model alias/name (default: sonnet)
  --concurrency <n>           Max parallel trials (default: 4)
  --timeout <seconds>         Timeout per turn in seconds (default: 180)
  --followup [prompt]         Run a Turn-2 follow-up refinement after Turn 1 (default: cognitive-load prompt)
  --from-run <dir>            Seed Turn 1 from an existing eval result dir and execute Turn 2 on top of it
  --out <dir>                 Output directory (default: evals/results/<timestamp>)
  --dry-run                   List selected tasks and exit without calling Claude
`);
      process.exit(0);
    } else if (arg === "--mode") {
      const val = argv[++i];
      if (val === "cli") modes = ["cli"];
      else if (val === "yaml") modes = ["yaml"];
      else if (val === "both") modes = ["cli", "yaml"];
      else throw new Error(`Invalid --mode '${val}'. Expected cli, yaml, or both.`);
    } else if (arg === "--task") {
      const val = argv[++i] ?? "";
      taskFilter = new Set(
        val
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      );
    } else if (arg === "--model") {
      model = argv[++i] ?? model;
    } else if (arg === "--concurrency") {
      concurrency = Math.max(1, Number(argv[++i] ?? 4));
    } else if (arg === "--timeout") {
      timeoutMs = Math.max(10, Number(argv[++i] ?? 180)) * 1000;
    } else if (arg === "--followup") {
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        followUpPrompt = next;
        i++;
      } else {
        followUpPrompt = COGNITIVE_LOAD_FOLLOWUP_PROMPT;
      }
    } else if (arg === "--from-run") {
      fromRunDir = argv[++i] ?? null;
    } else if (arg === "--out") {
      outDir = argv[++i] ?? null;
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else {
      throw new Error(`Unknown option '${arg}'. Run with --help.`);
    }
  }

  return { modes, taskFilter, model, concurrency, timeoutMs, dryRun, outDir, followUpPrompt, fromRunDir };
}

/** Finds a working `claude` binary, skipping broken shims if another install exists. */
async function resolveClaudeBinary(): Promise<string> {
  const candidates = [
    process.env.CLAUDE_BIN,
    "/opt/homebrew/bin/claude",
    join(homedir(), ".local/bin/claude"),
    "claude",
  ].filter((v): v is string => Boolean(v));

  async function probe(index: number): Promise<string> {
    const bin = candidates[index];
    if (!bin) {
      throw new Error("Could not find a working 'claude' CLI binary. Set CLAUDE_BIN=/path/to/claude.");
    }
    try {
      await execFileAsync(bin, ["--version"], { timeout: 10_000 });
      return bin;
    } catch {
      return probe(index + 1);
    }
  }
  return probe(0);
}

async function ensureCliBuilt(): Promise<string> {
  const cliPath = resolve("dist/cli.js");
  try {
    await access(cliPath);
  } catch {
    process.stderr.write("Building dist/cli.js...\n");
    await execFileAsync(process.execPath, [resolve("scripts/build-cli.ts")]);
  }
  return cliPath;
}

async function invokeClaude(
  claudeBin: string,
  prompt: string,
  workdir: string,
  opts: RunnerOptions,
): Promise<{ resp: ClaudeJsonResponse | null; rawStdout: string; error: string | null; durationMs: number }> {
  const startedAt = Date.now();
  const args = [
    "-p",
    prompt,
    "--output-format",
    "json",
    "--model",
    opts.model,
    "--no-session-persistence",
    "--safe-mode",
    "--tools",
    "Bash,Read,Write,Edit",
    "--permission-mode",
    "bypassPermissions",
  ];
  try {
    const { stdout } = await execFileAsync(claudeBin, args, {
      cwd: workdir,
      timeout: opts.timeoutMs,
      maxBuffer: 20 * 1024 * 1024,
      env: { ...process.env, CLAUDECODE: "" },
    });
    const resp = JSON.parse(stdout) as ClaudeJsonResponse;
    return { resp, rawStdout: stdout, error: null, durationMs: resp.duration_ms ?? Date.now() - startedAt };
  } catch (error) {
    const err = error as Error & { stdout?: string };
    const rawStdout = err.stdout ?? "";
    let resp: ClaudeJsonResponse | null = null;
    if (rawStdout.trim().startsWith("{")) {
      try {
        resp = JSON.parse(rawStdout) as ClaudeJsonResponse;
      } catch {
        // ignore parse failure
      }
    }
    return {
      resp,
      rawStdout,
      error: err.message,
      durationMs: resp?.duration_ms ?? Date.now() - startedAt,
    };
  }
}

async function inspectArtifact(
  cliPath: string,
  workdir: string,
  artifactPath: string,
): Promise<{ inspection: InspectedDiagram | null; error: string | null }> {
  try {
    const { stdout } = await execFileAsync(process.execPath, [cliPath, "inspect", artifactPath, "--json"], {
      cwd: workdir,
      timeout: 15_000,
    });
    const data = JSON.parse(stdout) as InspectedDiagram & { ok: boolean };
    return data.ok
      ? { inspection: data, error: null }
      : { inspection: null, error: "inspect returned ok=false" };
  } catch (error) {
    return { inspection: null, error: error instanceof Error ? error.message : String(error) };
  }
}

function extractInputTokens(resp: ClaudeJsonResponse | null): number | null {
  const usage = resp?.usage;
  if (!usage) return null;
  return (
    (usage.input_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0)
  );
}

async function runTrial(
  task: EvalTask,
  mode: EvalMode,
  claudeBin: string,
  cliPath: string,
  opts: RunnerOptions,
  resultsDir: string,
  seededTrial: TrialResult | null,
): Promise<TrialResult> {
  const workdir = await mkdtemp(join(tmpdir(), `pcfg-eval-${task.id}-${mode}-`));
  const artifactName = mode === "cli" ? "diagram.json" : "diagram.yaml";
  const trialDir = join(resultsDir, "trials", `${task.id}__${mode}`);
  await mkdir(trialDir, { recursive: true });

  try {
    let baseTrial: TrialResult;

    if (seededTrial && seededTrial.artifactText) {
      // Replay Turn 1 artifacts into the isolated workdir for Turn 2 follow-up
      await writeFile(join(workdir, artifactName), seededTrial.artifactText, "utf8");
      if (seededTrial.svg) await writeFile(join(workdir, "output.svg"), seededTrial.svg, "utf8");
      await writeFile(join(trialDir, `turn1-${artifactName}`), seededTrial.artifactText, "utf8");
      if (seededTrial.svg) await writeFile(join(trialDir, "turn1-output.svg"), seededTrial.svg, "utf8");
      baseTrial = {
        ...seededTrial,
        flowMetrics:
          seededTrial.flowMetrics ??
          (seededTrial.inspection ? computeFlowMetrics(seededTrial.inspection) : null),
      };
    } else {
      if (task.setup) await task.setup(workdir, mode, cliPath);
      const prompt = buildAgentPrompt(task, mode, cliPath);
      const run = await invokeClaude(claudeBin, prompt, workdir, opts);
      const svg = await readOptionalText(join(workdir, "output.svg"));
      const artifactText = await readOptionalText(join(workdir, artifactName));

      if (svg) await writeFile(join(trialDir, "output.svg"), svg, "utf8");
      if (artifactText) await writeFile(join(trialDir, artifactName), artifactText, "utf8");
      await writeFile(join(trialDir, "claude.json"), run.rawStdout || run.error || "", "utf8");

      const inspected = artifactText
        ? await inspectArtifact(cliPath, workdir, join(workdir, artifactName))
        : { inspection: null, error: null };

      const grade = inspected.inspection
        ? task.grade(inspected.inspection, svg ?? "")
        : {
            passed: false,
            checks: [
              {
                name: `valid ${artifactName} & output.svg`,
                passed: false,
                detail: inspected.error ?? run.error ?? `Missing ${artifactName}`,
              },
            ],
          };

      baseTrial = {
        taskId: task.id,
        taskTitle: task.title,
        taskCategory: task.category,
        taskDescription: task.description,
        mode,
        runner: "claude",
        model: opts.model,
        passed: grade.passed,
        grade,
        qualityOk: inspected.inspection?.quality.ok ?? false,
        qualityIssues: inspected.inspection?.quality.issueCount ?? 1,
        hoppedCrossings: inspected.inspection?.quality.hoppedCrossings ?? 0,
        flowMetrics: inspected.inspection ? computeFlowMetrics(inspected.inspection) : null,
        numTurns: run.resp?.num_turns ?? 0,
        durationMs: run.durationMs,
        costUsd: run.resp?.total_cost_usd ?? null,
        inputTokens: extractInputTokens(run.resp),
        outputTokens: run.resp?.usage?.output_tokens ?? null,
        svg,
        artifactText,
        artifactName,
        agentOutput: run.resp?.result ?? "",
        error: run.error ?? inspected.error,
        inspection: inspected.inspection,
      };
    }

    if (opts.followUpPrompt) {
      const fuPrompt = buildFollowUpPrompt(task, mode, cliPath, opts.followUpPrompt);
      const fuRun = await invokeClaude(claudeBin, fuPrompt, workdir, opts);
      const fuSvg = await readOptionalText(join(workdir, "output.svg"));
      const fuArtifact = await readOptionalText(join(workdir, artifactName));

      if (fuSvg) await writeFile(join(trialDir, "turn2-output.svg"), fuSvg, "utf8");
      if (fuArtifact) await writeFile(join(trialDir, `turn2-${artifactName}`), fuArtifact, "utf8");
      await writeFile(join(trialDir, "turn2-claude.json"), fuRun.rawStdout || fuRun.error || "", "utf8");

      const fuInspected = fuArtifact
        ? await inspectArtifact(cliPath, workdir, join(workdir, artifactName))
        : { inspection: null, error: null };

      const fuGrade = fuInspected.inspection
        ? gradeLayoutFollowUp(fuInspected.inspection, fuSvg ?? "", baseTrial.inspection)
        : {
            passed: false,
            checks: [
              {
                name: `valid ${artifactName} & output.svg`,
                passed: false,
                detail: fuInspected.error ?? fuRun.error ?? `Missing ${artifactName}`,
              },
            ],
          };

      const followUp: FollowUpResult = {
        prompt: opts.followUpPrompt,
        passed: fuGrade.passed,
        grade: fuGrade,
        qualityOk: fuInspected.inspection?.quality.ok ?? false,
        qualityIssues: fuInspected.inspection?.quality.issueCount ?? 1,
        flowMetrics: fuInspected.inspection ? computeFlowMetrics(fuInspected.inspection) : null,
        numTurns: fuRun.resp?.num_turns ?? 0,
        durationMs: fuRun.durationMs,
        costUsd: fuRun.resp?.total_cost_usd ?? null,
        inputTokens: extractInputTokens(fuRun.resp),
        outputTokens: fuRun.resp?.usage?.output_tokens ?? null,
        svg: fuSvg,
        artifactText: fuArtifact,
        agentOutput: fuRun.resp?.result ?? "",
        error: fuRun.error ?? fuInspected.error,
        inspection: fuInspected.inspection,
      };
      baseTrial.followUp = followUp;
    }

    return baseTrial;
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
}

async function readOptionalText(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

async function runPool<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results = Array.from<R>({ length: items.length });
  let cursor = 0;

  async function next(): Promise<void> {
    const idx = cursor++;
    const item = items[idx];
    if (item === undefined) return;
    results[idx] = await worker(item);
    return next();
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => next());
  await Promise.all(workers);
  return results;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const tasks = opts.taskFilter ? EVAL_TASKS.filter((t) => opts.taskFilter?.has(t.id)) : EVAL_TASKS;
  if (tasks.length === 0) {
    throw new Error(`No matching tasks. Available: ${EVAL_TASKS.map((t) => t.id).join(", ")}`);
  }

  let seededTrials = new Map<string, TrialResult>();
  if (opts.fromRunDir) {
    const summaryRaw = await readFile(resolve(opts.fromRunDir, "summary.json"), "utf8");
    const prev = JSON.parse(summaryRaw) as EvalReportData;
    seededTrials = new Map(prev.trials.map((t) => [`${t.taskId}::${t.mode}`, t]));
    if (!opts.followUpPrompt) opts.followUpPrompt = COGNITIVE_LOAD_FOLLOWUP_PROMPT;
  }

  if (opts.dryRun) {
    process.stdout.write(
      `Selected ${tasks.length} tasks × ${opts.modes.length} modes (${opts.modes.join(", ")}):\n`,
    );
    for (const t of tasks) process.stdout.write(`  - ${t.id}: ${t.title}\n`);
    if (opts.followUpPrompt) process.stdout.write(`Follow-up prompt: ${opts.followUpPrompt}\n`);
    return;
  }

  const cliPath = await ensureCliBuilt();
  const claudeBin = await resolveClaudeBinary();

  const runId = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const resultsDir = resolve(opts.outDir ?? join("evals/results", runId));
  await mkdir(resultsDir, { recursive: true });

  const jobs: { task: EvalTask; mode: EvalMode }[] = [];
  for (const task of tasks) {
    for (const mode of opts.modes) {
      jobs.push({ task, mode });
    }
  }

  process.stderr.write(
    `Running ${jobs.length} eval trials (${tasks.length} tasks × [${opts.modes.join(", ")}]${opts.followUpPrompt ? ", with Turn-2 follow-up" : ""}) with ${claudeBin} (model=${opts.model}, concurrency=${opts.concurrency})...\n`,
  );

  let completed = 0;
  const trials = await runPool(jobs, opts.concurrency, async ({ task, mode }) => {
    const seeded = seededTrials.get(`${task.id}::${mode}`) ?? null;
    const result = await runTrial(task, mode, claudeBin, cliPath, opts, resultsDir, seeded);
    completed++;
    const fu = result.followUp;
    const status = (fu ? fu.passed : result.passed) ? "PASS" : "FAIL";
    const turns = fu ? fu.numTurns : result.numTurns;
    const secs = ((fu ? fu.durationMs : result.durationMs) / 1000).toFixed(1);
    const q = fu ? fu.qualityIssues : result.qualityIssues;
    process.stderr.write(
      `[${completed}/${jobs.length}] ${task.id} (${mode}): ${status} — ${turns} turns, ${secs}s, qualityIssues=${q}\n`,
    );
    return result;
  });

  const report: EvalReportData = {
    runId,
    createdAt: new Date().toISOString(),
    runner: "claude",
    model: opts.model,
    ...(opts.followUpPrompt ? { followUpPrompt: opts.followUpPrompt } : {}),
    summaries: {
      cli: summarizeByMode(trials, "cli"),
      yaml: summarizeByMode(trials, "yaml"),
    },
    trials,
  };

  const summaryPath = join(resultsDir, "summary.json");
  const reportHtmlPath = join(resultsDir, "report.html");
  const embeddedHtmlPath = join(resultsDir, "report-inline.html");

  await writeFile(summaryPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(reportHtmlPath, generateHtmlGallery(report, { embedded: false }), "utf8");
  await writeFile(embeddedHtmlPath, generateHtmlGallery(report, { embedded: true }), "utf8");

  process.stdout.write(`\n${formatTextSummary(report)}\n`);
  process.stdout.write(`Gallery HTML: ${reportHtmlPath}\n`);
  process.stdout.write(`Summary JSON: ${summaryPath}\n`);
}

await main();
