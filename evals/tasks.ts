import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type EvalMode = "cli" | "yaml";

export type InspectedNode = {
  id: string;
  kind: string;
  label: string;
  line: number;
  endLine: number;
  x: number;
  y: number;
  width: number;
  height: number;
  cx: number;
  cy: number;
};

export type InspectedSegment = {
  index: number;
  orientation: "horizontal" | "vertical" | "diagonal";
  shiftAxis: "x" | "y" | null;
  coord: number | null;
  from: { x: number; y: number };
  to: { x: number; y: number };
  length: number;
};

export type InspectedEdge = {
  index: number;
  handle: string;
  key: string;
  source: string;
  target: string;
  label: string | null;
  shortLabel: string | null;
  back: boolean;
  jump: boolean;
  sourceSide: "top" | "right" | "bottom" | "left";
  targetSide: "top" | "right" | "bottom" | "left";
  mode: "auto" | "sides" | "points";
  points: { x: number; y: number }[];
  segments: InspectedSegment[];
};

export type InspectedDiagram = {
  language: "python" | "cuda";
  granularity: "block" | "statement";
  diagnostics: { line: number; message: string; severity: "error" | "warning" }[];
  nodes: InspectedNode[];
  edges: InspectedEdge[];
  quality: {
    ok: boolean;
    issueCount: number;
    nodeOverlaps: { a: string; b: string }[];
    edgesThroughNodes: { edgeIndex: number; edgeKey: string; nodeId: string }[];
    collinearEdgeOverlaps: { edgeA: number; edgeB: number; overlapLength: number }[];
    unhoppedCrossings: { edgeA: number; edgeB: number }[];
    coveredLabels: { edgeIndex: number; edgeKey: string; label: string }[];
    hoppedCrossings: number;
  };
};

export type CheckResult = {
  name: string;
  passed: boolean;
  detail: string;
};

export type GradeResult = {
  passed: boolean;
  checks: CheckResult[];
};

export type FlowMetrics = {
  qualityIssues: number;
  hoppedCrossings: number;
  totalBends: number;
  totalEdgeLength: number;
  upwardForwardEdges: number;
  width: number;
  height: number;
};

export type EvalTask = {
  id: string;
  title: string;
  category: string;
  description: string;
  prompt: string;
  setup?: (workdir: string, mode: EvalMode, cliPath: string) => Promise<void>;
  grade: (info: InspectedDiagram, svg: string) => GradeResult;
};

export const COGNITIVE_LOAD_FOLLOWUP_PROMPT =
  "trueを左、falseを右を強制しなくていいので、フローがシンプルで、認知的負荷が少ないレイアウトになるようにしてください。";

export function computeFlowMetrics(info: InspectedDiagram): FlowMetrics {
  let totalBends = 0;
  let totalEdgeLength = 0;
  let upwardForwardEdges = 0;
  const nodeById = new Map(info.nodes.map((n) => [n.id, n]));

  for (const edge of info.edges) {
    totalBends += Math.max(0, edge.points.length - 2);
    for (const seg of edge.segments) totalEdgeLength += seg.length;
    if (!edge.back) {
      const src = nodeById.get(edge.source);
      const tgt = nodeById.get(edge.target);
      if (src && tgt && tgt.y + tgt.height < src.y) upwardForwardEdges++;
    }
  }

  const allX = [
    ...info.nodes.flatMap((n) => [n.x, n.x + n.width]),
    ...info.edges.flatMap((e) => e.points.map((p) => p.x)),
  ];
  const allY = [
    ...info.nodes.flatMap((n) => [n.y, n.y + n.height]),
    ...info.edges.flatMap((e) => e.points.map((p) => p.y)),
  ];
  const width = allX.length > 0 ? Math.round(Math.max(...allX) - Math.min(...allX)) : 0;
  const height = allY.length > 0 ? Math.round(Math.max(...allY) - Math.min(...allY)) : 0;

  return {
    qualityIssues: info.quality.issueCount,
    hoppedCrossings: info.quality.hoppedCrossings,
    totalBends,
    totalEdgeLength: Math.round(totalEdgeLength),
    upwardForwardEdges,
    width,
    height,
  };
}

/** Grades a layout-refinement follow-up turn: source graph must remain intact and quality must be 0 issues. */
export function gradeLayoutFollowUp(
  after: InspectedDiagram,
  svg: string,
  before: InspectedDiagram | null,
): GradeResult {
  const beforeLabels = before ? before.nodes.map((n) => `${n.kind}:${n.label}`).toSorted() : null;
  const afterLabels = after.nodes.map((n) => `${n.kind}:${n.label}`).toSorted();
  const graphPreserved =
    beforeLabels === null ||
    (beforeLabels.length === afterLabels.length &&
      beforeLabels.every((val, i) => val === afterLabels[i]) &&
      before?.edges.length === after.edges.length);

  return summarize([
    svgCheck(svg),
    {
      name: "CFG structure & code preserved",
      passed: graphPreserved,
      detail: graphPreserved
        ? `${after.nodes.length} nodes, ${after.edges.length} edges unchanged`
        : `nodes ${before?.nodes.length ?? "?"}->${after.nodes.length}, edges ${before?.edges.length ?? "?"}->${after.edges.length}`,
    },
    {
      name: "no error diagnostics",
      passed: after.diagnostics.filter((d) => d.severity === "error").length === 0,
      detail: `${after.diagnostics.length} diagnostics`,
    },
    qualityCheck(after),
  ]);
}

function findNode(info: InspectedDiagram, substr: string): InspectedNode | undefined {
  return info.nodes.find((n) => n.label.includes(substr));
}

function qualityCheck(info: InspectedDiagram): CheckResult {
  return {
    name: "quality.ok (0 layout/routing issues)",
    passed: info.quality.ok,
    detail: info.quality.ok
      ? `0 issues (${info.quality.hoppedCrossings} hopped crossings)`
      : `${info.quality.issueCount} issues (overlaps=${info.quality.nodeOverlaps.length}, throughNodes=${info.quality.edgesThroughNodes.length}, collinear=${info.quality.collinearEdgeOverlaps.length}, unhopped=${info.quality.unhoppedCrossings.length}, coveredLabels=${info.quality.coveredLabels.length})`,
  };
}

function svgCheck(svg: string): CheckResult {
  const valid = svg.trimStart().startsWith("<svg ") && svg.trimEnd().endsWith("</svg>");
  return {
    name: "valid SVG output",
    passed: valid,
    detail: valid ? `${svg.length} chars` : "missing or malformed <svg>",
  };
}

function summarize(checks: CheckResult[]): GradeResult {
  return { passed: checks.every((c) => c.passed), checks };
}

export const EVAL_TASKS: EvalTask[] = [
  {
    id: "t1-oneshot-python",
    title: "1. One-shot Python Binary Search",
    category: "generation",
    description: "Generate a clean CFG SVG from a Python binary search function.",
    prompt: `Create a control-flow graph for the following Python pseudocode and render it to \`output.svg\`:

\`\`\`python
def binary_search(items, target):
    lo, hi = 0, len(items) - 1
    while lo <= hi:
        mid = (lo + hi) // 2
        if items[mid] == target:
            return mid
        elif items[mid] < target:
            lo = mid + 1
        else:
            hi = mid - 1
    return -1
\`\`\`

Ensure there are 0 parser errors and 0 layout/routing quality issues.`,
    grade(info, svg) {
      const required = [
        "binary_search",
        "while lo <= hi",
        "if items[mid] == target",
        "return mid",
        "return -1",
      ];
      const missing = required.filter((label) => !findNode(info, label));
      return summarize([
        svgCheck(svg),
        {
          name: "all expected nodes present",
          passed: missing.length === 0,
          detail: missing.length === 0 ? `${info.nodes.length} nodes` : `missing: ${missing.join(", ")}`,
        },
        {
          name: "no diagnostics",
          passed: info.diagnostics.length === 0,
          detail: `${info.diagnostics.length} diagnostics`,
        },
        qualityCheck(info),
      ]);
    },
  },

  {
    id: "t2-flip-branch",
    title: "2. Flip False Branch to Left + Pin Side",
    category: "branch-layout",
    description:
      "Move the False branch to the left of the condition and route the F edge out of its left side.",
    prompt: `Create a control-flow graph for this Python function and render it to \`output.svg\`:

\`\`\`python
def classify(x):
    if x > 0:
        label = "positive"
    else:
        label = "non-positive"
    return label
\`\`\`

Layout requirements:
1. Place the \`label = "non-positive"\` node to the **left** of the \`if x > 0\` diamond (not the right), with a clean horizontal gap (~48px).
2. Route the \`False\` edge from \`if x > 0\` to \`label = "non-positive"\` so it exits from the **left** side of \`if x > 0\` and enters the **top** of \`label = "non-positive"\`.
3. Ensure \`pseudo-cfg check\` passes with 0 layout/routing issues.`,
    grade(info, svg) {
      const cond = findNode(info, "if x > 0");
      const neg = findNode(info, 'label = "non-positive"');
      const fEdge =
        cond && neg ? info.edges.find((e) => e.source === cond.id && e.target === neg.id) : undefined;
      return summarize([
        svgCheck(svg),
        {
          name: "non-positive is to the left of if x > 0",
          passed: Boolean(cond && neg && neg.x + neg.width <= cond.x - 16),
          detail:
            cond && neg
              ? `neg.right=${Math.round(neg.x + neg.width)}, cond.left=${Math.round(cond.x)}`
              : "node(s) missing",
        },
        {
          name: "False edge exits left and enters top",
          passed: fEdge?.sourceSide === "left" && fEdge?.targetSide === "top",
          detail: fEdge ? `${fEdge.sourceSide} -> ${fEdge.targetSide}` : "edge missing",
        },
        qualityCheck(info),
      ]);
    },
  },

  {
    id: "t3-symmetric-diamond",
    title: "3. Symmetric Left/Right Diamond Branches",
    category: "alignment",
    description: "Place True left and False right symmetrically on one row, with merge centered below.",
    prompt: `Create a symmetric diamond-style control-flow graph for this Python pseudocode and render it to \`output.svg\`:

\`\`\`python
if valid:
    accept()
else:
    reject()
done()
\`\`\`

Layout requirements:
1. Keep \`if valid\` centered on top, and place \`accept()\` to its **left** and \`reject()\` to its **right** on the **exact same horizontal row** (same center Y, below \`if valid\`).
2. Route the \`True\` edge out of the **left** side of \`if valid\` (into \`top\` of \`accept()\`), and the \`False\` edge out of the **right** side of \`if valid\` (into \`top\` of \`reject()\`).
3. Center \`done()\` horizontally with \`if valid\` (same center X) below both \`accept()\` and \`reject()\`.
4. Ensure \`pseudo-cfg check\` passes with 0 issues.`,
    grade(info, svg) {
      const cond = findNode(info, "if valid");
      const acc = findNode(info, "accept()");
      const rej = findNode(info, "reject()");
      const done = findNode(info, "done()");
      const tEdge =
        cond && acc ? info.edges.find((e) => e.source === cond.id && e.target === acc.id) : undefined;
      const fEdge =
        cond && rej ? info.edges.find((e) => e.source === cond.id && e.target === rej.id) : undefined;
      return summarize([
        svgCheck(svg),
        {
          name: "accept() left & reject() right on same row below if",
          passed: Boolean(
            cond &&
            acc &&
            rej &&
            acc.cx < cond.cx - 20 &&
            rej.cx > cond.cx + 20 &&
            Math.abs(acc.cy - rej.cy) <= 4 &&
            acc.y > cond.y + cond.height,
          ),
          detail:
            cond && acc && rej
              ? `if.cx=${cond.cx}, acc=(${acc.cx},${acc.cy}), rej=(${rej.cx},${rej.cy})`
              : "node(s) missing",
        },
        {
          name: "T exits left->top, F exits right->top",
          passed:
            tEdge?.sourceSide === "left" &&
            tEdge?.targetSide === "top" &&
            fEdge?.sourceSide === "right" &&
            fEdge?.targetSide === "top",
          detail: `T=${tEdge ? `${tEdge.sourceSide}->${tEdge.targetSide}` : "missing"}, F=${fEdge ? `${fEdge.sourceSide}->${fEdge.targetSide}` : "missing"}`,
        },
        {
          name: "done() centered below branches",
          passed: Boolean(
            cond && acc && done && Math.abs(done.cx - cond.cx) <= 4 && done.y > acc.y + acc.height,
          ),
          detail: cond && done ? `if.cx=${cond.cx}, done.cx=${done.cx}, done.y=${done.y}` : "node(s) missing",
        },
        qualityCheck(info),
      ]);
    },
  },

  {
    id: "t4-backedge-lane",
    title: "4. Widen Loop Back-Edge Lane",
    category: "edge-shift",
    description: "Shift the vertical climb segment of a loop back-edge at least 80px left of all nodes.",
    prompt: `Create a control-flow graph for this loop and render it to \`output.svg\`:

\`\`\`python
i = 0
while i < n:
    if skip(i):
        i = i + 1
        continue
    process(i)
    i = i + 1
finish()
\`\`\`

Layout requirements:
1. Locate the loop back-edge returning from \`process(i)\` (the block ending with \`i = i + 1\` after \`process(i)\`) back up to \`while i < n\`.
2. Slide its vertical climb lane on the left further outward so that its x-coordinate is at least **80px to the left** of the leftmost node box (\`x <= minNodeX - 80\`).
3. Ensure \`pseudo-cfg check\` passes with 0 issues.`,
    grade(info, svg) {
      const minNodeX = Math.min(...info.nodes.map((n) => n.x));
      const proc = findNode(info, "process(i)");
      const head = findNode(info, "while i < n");
      const back =
        proc && head
          ? info.edges.find((e) => e.source === proc.id && e.target === head.id && e.back)
          : undefined;
      const leftmostVert = back
        ? Math.min(
            ...back.segments
              .filter((s) => s.orientation === "vertical" && s.coord !== null)
              .map((s) => s.coord as number),
          )
        : Infinity;
      const threshold = minNodeX - 80;
      return summarize([
        svgCheck(svg),
        {
          name: `back-edge vertical lane <= ${Math.round(threshold)} (minNodeX - 80)`,
          passed: Number.isFinite(leftmostVert) && leftmostVert <= threshold + 0.5,
          detail: `leftmostVert=${leftmostVert}, minNodeX=${minNodeX}, required<=${threshold}`,
        },
        qualityCheck(info),
      ]);
    },
  },

  {
    id: "t5-custom-early-return",
    title: "5. Route Early Return via Right-Side Lane",
    category: "edge-routing",
    description: "Route an early-return jump edge from right->right via a dedicated outer right lane.",
    prompt: `Create a control-flow graph for this Python function and render it to \`output.svg\`:

\`\`\`python
def compute(x):
    if x < 0:
        return -1
    y = x * 2
    z = y + 1
    return z
\`\`\`

Layout requirements:
1. Route the early-return edge from \`return -1\` to the \`return\` end node so it exits from the **right** side of \`return -1\` and enters the **right** side of \`return\`.
2. Make sure its vertical lane on the right sits cleanly outside all nodes by at least **60px** (\`x >= maxNodeRight + 60\`).
3. Ensure \`pseudo-cfg check\` passes with 0 issues.`,
    grade(info, svg) {
      const maxNodeRight = Math.max(...info.nodes.map((n) => n.x + n.width));
      const early = findNode(info, "return -1");
      const end = info.nodes.find((n) => n.kind === "end");
      const edge =
        early && end ? info.edges.find((e) => e.source === early.id && e.target === end.id) : undefined;
      const rightmostVert = edge
        ? Math.max(
            ...edge.segments
              .filter((s) => s.orientation === "vertical" && s.coord !== null)
              .map((s) => s.coord as number),
          )
        : -Infinity;
      const threshold = maxNodeRight + 60;
      return summarize([
        svgCheck(svg),
        {
          name: "early-return edge exits right and enters right",
          passed: edge?.sourceSide === "right" && edge?.targetSide === "right",
          detail: edge ? `${edge.sourceSide} -> ${edge.targetSide}` : "edge missing",
        },
        {
          name: `right vertical lane >= ${Math.round(threshold)} (maxNodeRight + 60)`,
          passed: Number.isFinite(rightmostVert) && rightmostVert >= threshold - 0.5,
          detail: `rightmostVert=${rightmostVert}, maxNodeRight=${maxNodeRight}, required>=${threshold}`,
        },
        qualityCheck(info),
      ]);
    },
  },

  {
    id: "t6-incremental-edit",
    title: "6. Incremental Code Edit Preserving Custom Layout",
    category: "edit-preservation",
    description:
      "Add statements to an existing customized diagram without losing its left-side branch layout.",
    prompt: `There is already an existing diagram in the working directory (\`diagram.json\` in CLI mode or \`diagram.yaml\` in YAML mode) where the \`False\` branch (\`fallback()\`) is positioned to the **left** of \`if ready:\` and its \`False\` edge exits from the **left** side.

Task:
1. Update the pseudocode so the \`True\` branch executes **three** statements instead of one:
   \`\`\`python
   if ready:
       log("starting")
       run()
       count = count + 1
   else:
       fallback()
   finish()
   \`\`\`
2. Preserve the custom layout: \`fallback()\` must remain to the **left** of \`if ready\`, and the \`False\` edge must still exit from the **left** side of \`if ready\`.
3. Verify with \`pseudo-cfg check\` (0 issues) and render the updated diagram to \`output.svg\`.`,
    async setup(workdir, mode, cliPath) {
      const initialYaml = `language: python
granularity: block
source: |
  if ready:
      run()
  else:
      fallback()
  finish()

layout:
  nodes:
    "fallback()":
      leftOf: "if ready"
      gap: 48
  edges:
    "if ready -> fallback() [F]":
      from: left
      to: top
`;
      if (mode === "yaml") {
        await writeFile(join(workdir, "diagram.yaml"), initialYaml, "utf8");
      } else {
        const tmpYaml = join(workdir, "_seed.yaml");
        await writeFile(tmpYaml, initialYaml, "utf8");
        await execFileAsync(process.execPath, [
          cliPath,
          "init",
          tmpYaml,
          "-o",
          join(workdir, "diagram.json"),
        ]);
        const { rm } = await import("node:fs/promises");
        await rm(tmpYaml, { force: true });
      }
    },
    grade(info, svg) {
      const cond = findNode(info, "if ready");
      const fb = findNode(info, "fallback()");
      const logNode = findNode(info, 'log("starting")');
      const countNode = findNode(info, "count = count + 1");
      const fEdge =
        cond && fb ? info.edges.find((e) => e.source === cond.id && e.target === fb.id) : undefined;
      return summarize([
        svgCheck(svg),
        {
          name: "new statements added (log & count)",
          passed: Boolean(logNode && countNode),
          detail: `log=${Boolean(logNode)}, count=${Boolean(countNode)}`,
        },
        {
          name: "fallback() kept to the left of if ready",
          passed: Boolean(cond && fb && fb.x + fb.width <= cond.x - 16),
          detail:
            cond && fb
              ? `fb.right=${Math.round(fb.x + fb.width)}, cond.left=${Math.round(cond.x)}`
              : "node(s) missing",
        },
        {
          name: "False edge still exits left",
          passed: fEdge?.sourceSide === "left",
          detail: fEdge ? `${fEdge.sourceSide} -> ${fEdge.targetSide}` : "edge missing",
        },
        qualityCheck(info),
      ]);
    },
  },

  {
    id: "t7-fix-broken-layout",
    title: "7. Repair Broken Layout (Overlap + Edge Collision)",
    category: "repair",
    description: "Fix a seeded diagram that has overlapping nodes and an edge cutting through a node.",
    prompt: `There is a broken diagram in the working directory (\`diagram.json\` in CLI mode or \`diagram.yaml\` in YAML mode).
Its layout currently fails \`pseudo-cfg check\` due to overlapping nodes and/or an edge passing through a node.

Task:
1. Keep the exact pseudocode unchanged.
2. Repair the node positions and/or edge routes so \`pseudo-cfg check\` passes with **0 issues**, while keeping \`b()\` positioned to the **right** of \`a()\` (\`b.x > a.x + a.width\`).
3. Render the fixed diagram to \`output.svg\`.`,
    async setup(workdir, mode, cliPath) {
      const brokenYaml = `language: python
granularity: block
source: |
  if flag:
      a()
  else:
      b()
  c()

layout:
  nodes:
    "b()":
      x: 20
      y: 220
    "a()":
      x: 10
      y: 215
  edges:
    "if flag -> b() [F]":
      from: bottom
      to: left
`;
      if (mode === "yaml") {
        await writeFile(join(workdir, "diagram.yaml"), brokenYaml, "utf8");
      } else {
        const tmpYaml = join(workdir, "_seed.yaml");
        await writeFile(tmpYaml, brokenYaml, "utf8");
        await execFileAsync(process.execPath, [
          cliPath,
          "init",
          tmpYaml,
          "-o",
          join(workdir, "diagram.json"),
        ]);
        const { rm } = await import("node:fs/promises");
        await rm(tmpYaml, { force: true });
      }
    },
    grade(info, svg) {
      const a = findNode(info, "a()");
      const b = findNode(info, "b()");
      const c = findNode(info, "c()");
      const cond = findNode(info, "if flag");
      return summarize([
        svgCheck(svg),
        {
          name: "source nodes intact",
          passed: Boolean(cond && a && b && c),
          detail: `${info.nodes.length} nodes`,
        },
        {
          name: "b() is cleanly to the right of a()",
          passed: Boolean(a && b && b.x >= a.x + a.width + 16),
          detail:
            a && b ? `a.right=${Math.round(a.x + a.width)}, b.left=${Math.round(b.x)}` : "node(s) missing",
        },
        qualityCheck(info),
      ]);
    },
  },

  {
    id: "t8-cuda-complex",
    title: "8. CUDA Kernel (Statement Granularity + Custom Layout)",
    category: "cuda-complex",
    description: "Render a CUDA kernel at statement granularity with custom branch layout and clean routing.",
    prompt: `Create a control-flow graph for this CUDA kernel at **statement** granularity and render it to \`output.svg\`:

\`\`\`cuda
__global__ void clamp_scale(int n, float a, const float *x, float *y) {
    int i = blockIdx.x * blockDim.x + threadIdx.x;
    if (i >= n) {
        return;
    }
    if (x[i] < 0) {
        y[i] = 0;
    } else {
        y[i] = a * x[i];
    }
}
\`\`\`

Requirements:
1. Use \`cuda\` language and \`statement\` granularity.
2. Place \`y[i] = a * x[i]\` directly to the **right** of \`if (x[i] < 0)\` on the same horizontal row (same center Y, gap ~48px), with its \`False\` edge exiting from the **right** side of \`if (x[i] < 0)\` and entering the **left** side of \`y[i] = a * x[i]\`.
3. Ensure \`pseudo-cfg check\` passes with 0 issues.`,
    grade(info, svg) {
      const cond = findNode(info, "x[i] < 0");
      const elseBlk = findNode(info, "y[i] = a * x[i]");
      const fEdge =
        cond && elseBlk ? info.edges.find((e) => e.source === cond.id && e.target === elseBlk.id) : undefined;
      return summarize([
        svgCheck(svg),
        {
          name: "language=cuda and granularity=statement",
          passed: info.language === "cuda" && info.granularity === "statement",
          detail: `lang=${info.language}, granularity=${info.granularity}`,
        },
        {
          name: "y[i] = a * x[i] right of if (x[i] < 0) on same row",
          passed: Boolean(
            cond && elseBlk && elseBlk.x >= cond.x + cond.width + 20 && Math.abs(elseBlk.cy - cond.cy) <= 4,
          ),
          detail:
            cond && elseBlk
              ? `cond.right=${Math.round(cond.x + cond.width)}, else.left=${Math.round(elseBlk.x)}, dy=${Math.round(Math.abs(elseBlk.cy - cond.cy))}`
              : "node(s) missing",
        },
        {
          name: "False edge routes right -> left",
          passed: fEdge?.sourceSide === "right" && fEdge?.targetSide === "left",
          detail: fEdge ? `${fEdge.sourceSide} -> ${fEdge.targetSide}` : "edge missing",
        },
        qualityCheck(info),
      ]);
    },
  },
];
