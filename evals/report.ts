import type { EvalMode, FlowMetrics, GradeResult, InspectedDiagram } from "./tasks.ts";

export type FollowUpResult = {
  prompt: string;
  passed: boolean;
  grade: GradeResult;
  qualityOk: boolean;
  qualityIssues: number;
  flowMetrics: FlowMetrics | null;
  numTurns: number;
  durationMs: number;
  costUsd: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  svg: string | null;
  artifactText: string | null;
  agentOutput: string;
  error: string | null;
  inspection: InspectedDiagram | null;
};

export type TrialResult = {
  taskId: string;
  taskTitle: string;
  taskCategory: string;
  taskDescription: string;
  mode: EvalMode;
  runner: string;
  model: string;
  passed: boolean;
  grade: GradeResult;
  qualityOk: boolean;
  qualityIssues: number;
  hoppedCrossings: number;
  flowMetrics: FlowMetrics | null;
  numTurns: number;
  durationMs: number;
  costUsd: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  svg: string | null;
  artifactText: string | null;
  artifactName: string;
  agentOutput: string;
  error: string | null;
  inspection: InspectedDiagram | null;
  followUp?: FollowUpResult;
};

export type ModeSummary = {
  mode: EvalMode;
  total: number;
  passed: number;
  passRate: number;
  qualityOkCount: number;
  avgTurns: number;
  avgDurationMs: number;
  totalCostUsd: number;
  avgInputTokens: number;
  avgOutputTokens: number;
  avgCrossings: number;
  avgBends: number;
  followUpPassed?: number;
  followUpAvgTurns?: number;
  followUpAvgDurationMs?: number;
  followUpTotalCostUsd?: number;
  followUpAvgCrossings?: number;
  followUpAvgBends?: number;
};

export type EvalReportData = {
  runId: string;
  createdAt: string;
  runner: string;
  model: string;
  followUpPrompt?: string;
  summaries: Record<EvalMode, ModeSummary>;
  trials: TrialResult[];
};

function average(nums: number[]): number {
  return nums.length > 0 ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}

export function summarizeByMode(trials: TrialResult[], mode: EvalMode): ModeSummary {
  const list = trials.filter((t) => t.mode === mode);
  const total = list.length;
  const passed = list.filter((t) => t.passed).length;
  const qualityOkCount = list.filter((t) => t.qualityOk).length;
  const costs = list.map((t) => t.costUsd).filter((v): v is number => v !== null);
  const inToks = list.map((t) => t.inputTokens).filter((v): v is number => v !== null);
  const outToks = list.map((t) => t.outputTokens).filter((v): v is number => v !== null);
  const crossings = list.map((t) => t.flowMetrics?.hoppedCrossings ?? t.hoppedCrossings);
  const bends = list.map((t) => t.flowMetrics?.totalBends).filter((v): v is number => v !== undefined);

  const summary: ModeSummary = {
    mode,
    total,
    passed,
    passRate: total > 0 ? Math.round((passed / total) * 1000) / 10 : 0,
    qualityOkCount,
    avgTurns: Math.round(average(list.map((t) => t.numTurns)) * 10) / 10,
    avgDurationMs: Math.round(average(list.map((t) => t.durationMs))),
    totalCostUsd: Math.round(costs.reduce((a, b) => a + b, 0) * 10000) / 10000,
    avgInputTokens: Math.round(average(inToks)),
    avgOutputTokens: Math.round(average(outToks)),
    avgCrossings: Math.round(average(crossings) * 10) / 10,
    avgBends: Math.round(average(bends) * 10) / 10,
  };

  const fus = list.map((t) => t.followUp).filter((f): f is FollowUpResult => f !== undefined);
  if (fus.length > 0) {
    const fuCosts = fus.map((f) => f.costUsd).filter((v): v is number => v !== null);
    summary.followUpPassed = fus.filter((f) => f.passed).length;
    summary.followUpAvgTurns = Math.round(average(fus.map((f) => f.numTurns)) * 10) / 10;
    summary.followUpAvgDurationMs = Math.round(average(fus.map((f) => f.durationMs)));
    summary.followUpTotalCostUsd = Math.round(fuCosts.reduce((a, b) => a + b, 0) * 10000) / 10000;
    summary.followUpAvgCrossings =
      Math.round(average(fus.map((f) => f.flowMetrics?.hoppedCrossings ?? 0)) * 10) / 10;
    summary.followUpAvgBends = Math.round(average(fus.map((f) => f.flowMetrics?.totalBends ?? 0)) * 10) / 10;
  }

  return summary;
}

/** Generates a concise Markdown/console summary table. */
export function formatTextSummary(report: EvalReportData): string {
  const lines: string[] = [];
  const hasFu = report.trials.some((t) => t.followUp !== undefined);
  lines.push(`# Pseudo CFG CLI vs YAML Eval — ${report.runId} (${report.runner} / ${report.model})`);
  if (report.followUpPrompt) {
    lines.push(`Follow-up (Turn 2): "${report.followUpPrompt}"`);
  }
  lines.push("");

  if (hasFu) {
    lines.push(
      "| Mode | T2 Pass | T2 Avg Turns | T2 Avg Time | T2 Cost | Crossings (T1→T2) | Bends (T1→T2) |",
    );
    lines.push("| :--- | ---: | ---: | ---: | ---: | ---: | ---: |");
    for (const mode of ["cli", "yaml"] as const) {
      const s = report.summaries[mode];
      if (s.total === 0) continue;
      lines.push(
        `| ${mode === "cli" ? "Imperative CLI" : "Declarative YAML"} | ${s.followUpPassed ?? 0}/${s.total} | ${s.followUpAvgTurns ?? 0} | ${((s.followUpAvgDurationMs ?? 0) / 1000).toFixed(1)}s | $${(s.followUpTotalCostUsd ?? 0).toFixed(4)} | ${s.avgCrossings} → ${s.followUpAvgCrossings ?? 0} | ${s.avgBends} → ${s.followUpAvgBends ?? 0} |`,
      );
    }
  } else {
    lines.push("| Mode | Pass Rate | Quality OK | Avg Turns | Avg Time | Total Cost |");
    lines.push("| :--- | ---: | ---: | ---: | ---: | ---: |");
    for (const mode of ["cli", "yaml"] as const) {
      const s = report.summaries[mode];
      if (s.total === 0) continue;
      lines.push(
        `| ${mode === "cli" ? "Imperative CLI" : "Declarative YAML"} | ${s.passed}/${s.total} (${s.passRate}%) | ${s.qualityOkCount}/${s.total} | ${s.avgTurns} | ${(s.avgDurationMs / 1000).toFixed(1)}s | $${s.totalCostUsd.toFixed(4)} |`,
      );
    }
  }

  lines.push("");
  lines.push("| Task | CLI | YAML |");
  lines.push("| :--- | :--- | :--- |");
  const taskIds = [...new Set(report.trials.map((t) => t.taskId))];
  for (const id of taskIds) {
    const cli = report.trials.find((t) => t.taskId === id && t.mode === "cli");
    const yaml = report.trials.find((t) => t.taskId === id && t.mode === "yaml");
    const title = cli?.taskTitle ?? yaml?.taskTitle ?? id;
    const fmt = (t: TrialResult | undefined) => {
      if (!t) return "-";
      if (t.followUp) {
        const fu = t.followUp;
        const c1 = t.flowMetrics?.hoppedCrossings ?? t.hoppedCrossings;
        const c2 = fu.flowMetrics?.hoppedCrossings ?? 0;
        const b1 = t.flowMetrics?.totalBends ?? 0;
        const b2 = fu.flowMetrics?.totalBends ?? 0;
        return `${fu.passed ? "PASS" : "FAIL"} (${fu.numTurns}t, ${(fu.durationMs / 1000).toFixed(1)}s, x:${c1}→${c2}, b:${b1}→${b2})`;
      }
      return `${t.passed ? "PASS" : "FAIL"} (${t.numTurns}t, ${(t.durationMs / 1000).toFixed(1)}s, q=${t.qualityIssues})`;
    };
    lines.push(`| ${title} | ${fmt(cli)} | ${fmt(yaml)} |`);
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Generates a self-contained HTML Visual Gallery report for side-by-side human inspection.
 * When follow-up results are present, shows Before (Turn 1) -> After (Turn 2) comparisons.
 */
export function generateHtmlGallery(report: EvalReportData, options: { embedded?: boolean } = {}): string {
  const embedded = Boolean(options.embedded);
  const hasFu = report.trials.some((t) => t.followUp !== undefined);
  const taskIds = [...new Set(report.trials.map((t) => t.taskId))];

  const summaryCards = (["cli", "yaml"] as const)
    .map((mode) => {
      const s = report.summaries[mode];
      if (s.total === 0) return "";
      const label = mode === "cli" ? "Mode A: Imperative CLI" : "Mode B: Declarative YAML";
      const badgeClass = mode === "cli" ? "badge-cli" : "badge-yaml";
      if (hasFu) {
        return `<div class="summary-card">
          <div class="summary-head"><span class="mode-badge ${badgeClass}">${label}</span><span class="big-score">T2: ${s.followUpPassed ?? 0}/${s.total}</span></div>
          <div class="metrics-grid">
            <div><span class="m-label">T2 Avg Turns</span><strong>${s.followUpAvgTurns ?? 0}</strong></div>
            <div><span class="m-label">T2 Avg Time</span><strong>${((s.followUpAvgDurationMs ?? 0) / 1000).toFixed(1)}s</strong></div>
            <div><span class="m-label">Crossings</span><strong>${s.avgCrossings} → ${s.followUpAvgCrossings ?? 0}</strong></div>
            <div><span class="m-label">Bends</span><strong>${s.avgBends} → ${s.followUpAvgBends ?? 0}</strong></div>
          </div>
        </div>`;
      }
      return `<div class="summary-card">
        <div class="summary-head"><span class="mode-badge ${badgeClass}">${label}</span><span class="big-score">${s.passed}/${s.total} (${s.passRate}%)</span></div>
        <div class="metrics-grid">
          <div><span class="m-label">Quality 0-issue</span><strong>${s.qualityOkCount}/${s.total}</strong></div>
          <div><span class="m-label">Avg Turns</span><strong>${s.avgTurns}</strong></div>
          <div><span class="m-label">Avg Time</span><strong>${(s.avgDurationMs / 1000).toFixed(1)}s</strong></div>
          <div><span class="m-label">Total Cost</span><strong>$${s.totalCostUsd.toFixed(4)}</strong></div>
        </div>
      </div>`;
    })
    .join("\n");

  const taskSections = taskIds
    .map((id) => {
      const cli = report.trials.find((t) => t.taskId === id && t.mode === "cli");
      const yaml = report.trials.find((t) => t.taskId === id && t.mode === "yaml");
      const meta = cli ?? yaml;
      if (!meta) return "";
      return `<section class="task-section">
        <header class="task-header">
          <div>
            <h2>${escapeHtml(meta.taskTitle)}</h2>
            <p class="task-desc">${escapeHtml(meta.taskDescription)}</p>
          </div>
          <span class="cat-pill">${escapeHtml(meta.taskCategory)}</span>
        </header>
        <div class="pair-grid">
          ${cli ? renderTrialCard(cli, "Imperative CLI", "badge-cli") : ""}
          ${yaml ? renderTrialCard(yaml, "Declarative YAML", "badge-yaml") : ""}
        </div>
      </section>`;
    })
    .join("\n");

  const followUpBanner = report.followUpPrompt
    ? `<div class="fu-banner"><strong>Turn 2 Follow-up Request:</strong> ${escapeHtml(report.followUpPrompt)}</div>`
    : "";

  const themeVars = embedded
    ? ""
    : `:root {
      --background: #0f1115;
      --foreground: #eceef2;
      --card: #171a21;
      --muted: #222631;
      --muted-foreground: #9ca3af;
      --border: #2b3140;
      --success: #22c55e;
      --destructive: #ef4444;
      --info: #3b82f6;
      --accent: #a855f7;
      --radius: 10px;
      --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      --font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }
    @media (prefers-color-scheme: light) {
      :root {
        --background: #f6f7f9;
        --foreground: #14171f;
        --card: #ffffff;
        --muted: #eef0f4;
        --muted-foreground: #5c6473;
        --border: #dde1ea;
      }
    }
    html, body { background: var(--background); color: var(--foreground); margin: 0; padding: 20px; }`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Pseudo CFG Eval Gallery — ${escapeHtml(report.runId)}</title>
  <style>
    ${themeVars}
    * { box-sizing: border-box; }
    body { font-family: var(--font-sans); line-height: 1.45; }
    .wrap { max-width: ${embedded ? "100%" : "1480px"}; margin: 0 auto; display: flex; flex-direction: column; gap: 18px; }
    .meta-bar { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: baseline; gap: 8px; }
    .meta-sub { font-size: 12px; color: var(--muted-foreground); font-family: var(--font-mono); }
    .fu-banner { background: var(--card); border: 1px solid var(--border); border-left: 3px solid var(--accent, #a855f7); border-radius: 8px; padding: 10px 14px; font-size: 13px; }
    .summary-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px; }
    .summary-card { background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); padding: 14px 16px; }
    .summary-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
    .big-score { font-size: 18px; font-weight: 700; font-variant-numeric: tabular-nums; }
    .metrics-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; font-size: 12px; }
    .metrics-grid strong { display: block; font-size: 14px; font-variant-numeric: tabular-nums; margin-top: 2px; }
    .m-label { color: var(--muted-foreground); font-size: 11px; }
    .mode-badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; }
    .badge-cli { background: color-mix(in srgb, var(--info, #3b82f6) 18%, transparent); color: var(--info, #3b82f6); }
    .badge-yaml { background: color-mix(in srgb, var(--accent, #a855f7) 18%, transparent); color: var(--accent, #a855f7); }
    .task-section { background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); padding: 14px 16px; }
    .task-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 12px; }
    .task-header h2 { margin: 0; font-size: 15px; font-weight: 650; }
    .task-desc { margin: 3px 0 0; font-size: 12px; color: var(--muted-foreground); }
    .cat-pill { font-size: 11px; font-family: var(--font-mono); padding: 2px 8px; border-radius: 999px; background: var(--muted); color: var(--muted-foreground); white-space: nowrap; }
    .pair-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(${embedded ? "300px" : "560px"}, 1fr)); gap: 12px; }
    .trial-card { border: 1px solid var(--border); border-radius: 8px; overflow: hidden; display: flex; flex-direction: column; background: var(--card); }
    .trial-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 8px 10px; border-bottom: 1px solid var(--border); font-size: 12px; }
    .trial-stats { color: var(--muted-foreground); font-family: var(--font-mono); font-size: 11px; }
    .status-pass { color: var(--success, #22c55e); font-weight: 700; }
    .status-fail { color: var(--destructive, #ef4444); font-weight: 700; }
    .before-after { display: grid; grid-template-columns: 1fr 1fr; border-bottom: 1px solid var(--border); }
    .stage-col { display: flex; flex-direction: column; min-width: 0; }
    .stage-col + .stage-col { border-left: 1px solid var(--border); }
    .stage-caption { padding: 4px 8px; font-size: 11px; font-family: var(--font-mono); color: var(--muted-foreground); background: var(--muted); border-bottom: 1px solid var(--border); }
    .svg-stage { background: #ffffff; padding: 10px; display: flex; align-items: center; justify-content: center; min-height: 220px; max-height: 360px; overflow: auto; cursor: zoom-in; flex: 1; }
    .svg-stage svg { max-width: 100%; max-height: 340px; width: auto; height: auto; display: block; }
    .svg-missing { color: #b91c1c; font-family: var(--font-mono); font-size: 12px; padding: 16px; }
    .flow-bar { padding: 6px 10px; border-bottom: 1px solid var(--border); font-size: 11px; font-family: var(--font-mono); color: var(--muted-foreground); display: flex; flex-wrap: wrap; gap: 12px; }
    .checks-list { list-style: none; margin: 0; padding: 8px 10px; display: flex; flex-direction: column; gap: 4px; font-size: 11.5px; }
    .checks-list li { display: flex; gap: 6px; align-items: baseline; }
    .check-ok { color: var(--success, #22c55e); font-weight: 700; }
    .check-bad { color: var(--destructive, #ef4444); font-weight: 700; }
    .check-detail { color: var(--muted-foreground); font-family: var(--font-mono); font-size: 10.5px; }
    details.artifact-box { border-top: 1px solid var(--border); padding: 6px 10px; font-size: 11px; }
    details.artifact-box summary { cursor: pointer; color: var(--muted-foreground); font-family: var(--font-mono); }
    details.artifact-box pre { margin: 6px 0 0; padding: 8px; background: var(--muted); border-radius: 6px; overflow: auto; max-height: 220px; font-family: var(--font-mono); font-size: 11px; white-space: pre-wrap; }
    .lightbox { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.82); display: none; align-items: center; justify-content: center; padding: 24px; z-index: 999; }
    .lightbox.open { display: flex; }
    .lightbox-inner { background: #ffffff; border-radius: 10px; padding: 16px; max-width: 95vw; max-height: 92vh; overflow: auto; position: relative; }
    .lightbox-inner svg { display: block; max-width: none; height: auto; }
    .lightbox-close { position: fixed; top: 14px; right: 20px; background: #111827; color: #fff; border: 1px solid #374151; border-radius: 6px; padding: 6px 12px; cursor: pointer; font-size: 12px; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="meta-bar">
      <strong style="font-size:16px">Pseudo CFG — Imperative CLI vs. Declarative YAML Eval Gallery</strong>
      <span class="meta-sub">${escapeHtml(report.runId)} · ${escapeHtml(report.runner)} (${escapeHtml(report.model)}) · Click any diagram to zoom</span>
    </div>
    ${followUpBanner}
    <div class="summary-row">${summaryCards}</div>
    ${taskSections}
  </div>

  <div class="lightbox" id="lightbox" onclick="if(event.target===this)closeLightbox()">
    <button class="lightbox-close" onclick="closeLightbox()">Close (Esc)</button>
    <div class="lightbox-inner" id="lightbox-inner"></div>
  </div>
  <script>
    function openLightbox(el) {
      const svg = el.querySelector('svg');
      if (!svg) return;
      const inner = document.getElementById('lightbox-inner');
      inner.innerHTML = svg.outerHTML;
      document.getElementById('lightbox').classList.add('open');
    }
    function closeLightbox() {
      document.getElementById('lightbox').classList.remove('open');
    }
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeLightbox(); });
  </script>
</body>
</html>`;
}

function renderTrialCard(trial: TrialResult, modeLabel: string, badgeClass: string): string {
  const fu = trial.followUp;
  const activePassed = fu ? fu.passed : trial.passed;
  const status = activePassed
    ? `<span class="status-pass">PASS</span>`
    : `<span class="status-fail">FAIL</span>`;
  const activeTurns = fu ? fu.numTurns : trial.numTurns;
  const activeMs = fu ? fu.durationMs : trial.durationMs;
  const activeCost = fu ? fu.costUsd : trial.costUsd;
  const cost = activeCost !== null ? ` · $${activeCost.toFixed(4)}` : "";
  const stats = `${fu ? "T2: " : ""}${activeTurns} turns · ${(activeMs / 1000).toFixed(1)}s${cost}`;

  const renderSvgBox = (svg: string | null, err: string | null) =>
    svg
      ? `<div class="svg-stage" onclick="openLightbox(this)">${svg}</div>`
      : `<div class="svg-stage"><div class="svg-missing">${escapeHtml(err ?? "No SVG generated")}</div></div>`;

  const stageHtml = fu
    ? `<div class="before-after">
        <div class="stage-col">
          <div class="stage-caption">Turn 1 (Before)</div>
          ${renderSvgBox(trial.svg, trial.error)}
        </div>
        <div class="stage-col">
          <div class="stage-caption">Turn 2 (After Follow-up)</div>
          ${renderSvgBox(fu.svg, fu.error)}
        </div>
      </div>`
    : `<div style="border-bottom: 1px solid var(--border)">${renderSvgBox(trial.svg, trial.error)}</div>`;

  const m1 = trial.flowMetrics;
  const m2 = fu?.flowMetrics;
  const flowBar =
    m1 && m2
      ? `<div class="flow-bar">
          <span>crossings: <strong>${m1.hoppedCrossings} → ${m2.hoppedCrossings}</strong></span>
          <span>bends: <strong>${m1.totalBends} → ${m2.totalBends}</strong></span>
          <span>wire: <strong>${m1.totalEdgeLength} → ${m2.totalEdgeLength}px</strong></span>
          <span>size: <strong>${m1.width}×${m1.height} → ${m2.width}×${m2.height}</strong></span>
        </div>`
      : m1
        ? `<div class="flow-bar">
            <span>crossings: <strong>${m1.hoppedCrossings}</strong></span>
            <span>bends: <strong>${m1.totalBends}</strong></span>
            <span>wire: <strong>${m1.totalEdgeLength}px</strong></span>
            <span>size: <strong>${m1.width}×${m1.height}</strong></span>
          </div>`
        : "";

  const activeGrade = fu ? fu.grade : trial.grade;
  const checksHtml = activeGrade.checks
    .map(
      (c) =>
        `<li><span class="${c.passed ? "check-ok" : "check-bad"}">${c.passed ? "✓" : "✗"}</span><span>${escapeHtml(c.name)} <span class="check-detail">(${escapeHtml(c.detail)})</span></span></li>`,
    )
    .join("");

  const activeArtifact = fu ? fu.artifactText : trial.artifactText;
  const artifactDetails = activeArtifact
    ? `<details class="artifact-box"><summary>${escapeHtml(trial.artifactName)}${fu ? " (Turn 2)" : ""}</summary><pre>${escapeHtml(activeArtifact)}</pre></details>`
    : "";

  return `<article class="trial-card">
    <div class="trial-head">
      <div><span class="mode-badge ${badgeClass}">${modeLabel}</span> ${status}</div>
      <span class="trial-stats">${escapeHtml(stats)}</span>
    </div>
    ${stageHtml}
    ${flowBar}
    <ul class="checks-list">${checksHtml}</ul>
    ${artifactDetails}
  </article>`;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
