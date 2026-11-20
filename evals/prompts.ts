import type { EvalMode, EvalTask } from "./tasks.ts";

/**
 * Builds equally clear, fair instructions for Mode A (Imperative CLI) and Mode B (Declarative YAML).
 */
export function buildAgentPrompt(task: EvalTask, mode: EvalMode, cliPath: string): string {
  const cmd = `node ${JSON.stringify(cliPath)}`;

  const modeGuide =
    mode === "cli"
      ? `You are using the **Imperative CLI** workflow of \`pseudo-cfg\`.
Run commands via: \`${cmd} <subcommand> ...\`

Required output files in the current working directory:
- \`diagram.json\` — the final workspace JSON file
- \`output.svg\` — the rendered SVG produced from \`diagram.json\`

Key Imperative CLI commands (all support \`--json\`):
- \`${cmd} init [file|-] -o diagram.json [--lang python|cuda] [--granularity block|statement] [--code "..."]\`
- \`${cmd} source diagram.json [file|-] [--code "..."]\`  (incremental code edit that preserves node positions & edge overrides)
- \`${cmd} set diagram.json [--granularity block|statement] [--lang python|cuda]\`
- \`${cmd} inspect diagram.json [--json]\`  (shows node IDs, positions, sizes, centers, edge handles e0.., sides, segments, quality)
- \`${cmd} node move diagram.json <id...> [--x N --y N | --cx N --cy N | --dx N --dy N | --below/--above/--left-of/--right-of/--align-x/--align-y <refId> --gap N]\`
- \`${cmd} edge list diagram.json\`
- \`${cmd} edge inspect diagram.json <edge>\`  (shows segment indices, H/V orientation, current x/y coord, and shift axis)
- \`${cmd} edge route diagram.json <edge> [--from top|right|bottom|left] [--to top|right|bottom|left]\`
- \`${cmd} edge shift diagram.json <edge> <segIndex> (<delta> | --at <coord>)\`
- \`${cmd} edge points diagram.json <edge> [--via "x1,y1 x2,y2 ..."] [--from side] [--to side]\`
- \`${cmd} edge reset diagram.json (<edge> | --all)\`
- \`${cmd} apply diagram.json --ops '<json>' [--render output.svg]\`
- \`${cmd} check diagram.json [--json]\`  (exits 0 when 0 errors and 0 layout/routing issues; exits 2 otherwise)
- \`${cmd} render diagram.json -o output.svg\`

Edge selectors accept handle (\`e4\`), pair (\`n2->n4\`, \`n2->n4:F\`), or exact key (\`n2>n4:False\`).
Do NOT write YAML files in this mode — manage the diagram with \`diagram.json\` and CLI commands.`
      : `You are using the **Declarative YAML** workflow of \`pseudo-cfg\`.
Run CLI inspection/check/render commands via: \`${cmd} <subcommand> ...\`

Required output files in the current working directory:
- \`diagram.yaml\` — the single self-contained declarative YAML diagram specification
- \`output.svg\` — the rendered SVG produced from \`diagram.yaml\`

YAML Spec schema (\`diagram.yaml\`):
\`\`\`yaml
language: python          # python | cuda (default: python)
granularity: block        # block | statement (default: block)
source: |
  # pseudocode here

layout:                   # optional overrides applied on top of structured auto-layout
  nodes:                  # applied in declaration order
    "<node-selector>":    # node ID (n4), line (L10), exact label, or unique substring
      x: 100              # absolute top-left (x, y) or center (cx, cy) or offset (dx, dy)
      leftOf: "<ref>"     # relational: leftOf, rightOf, below, above, alignX, alignY
      gap: 48             # spacing for relational placement (default: 40)
  edges:                  # applied after node positions are settled
    "<edge-selector>":    # handle (e4), ID pair (n3->n5:F), or labels ("if x -> y [F]")
      from: left          # pin exit side: top | right | bottom | left
      to: top             # pin entry side: top | right | bottom | left
      shift:              # slide segment(s) sideways (list of { segment, delta | at })
        - segment: 1
          at: -80         # exact x (for vertical) or y (for horizontal), or delta: -40
      via:                # OR intermediate orthogonal waypoints (anchors auto-added)
        - [420, 292]
        - [420, 220]
\`\`\`

Key commands for YAML specs:
- \`${cmd} inspect diagram.yaml [--json]\`  (shows compiled nodes, boxes, edge handles, segments, and quality)
- \`${cmd} edge inspect diagram.yaml "<edge-selector>"\`  (shows segment indices, orientation, and exact x/y coords)
- \`${cmd} check diagram.yaml [--json]\`  (exits 0 when 0 errors and 0 layout/routing issues; exits 2 otherwise)
- \`${cmd} render diagram.yaml -o output.svg\`

Write/edit \`diagram.yaml\` directly, verify with \`check\`, and render \`output.svg\`.`;

  return `${modeGuide}

---

## Task: ${task.title}

${task.prompt}

Work only in the current working directory. Be concise and stop once \`output.svg\` is rendered and \`check\` passes.`;
}

/**
 * Builds a realistic Turn-2 follow-up prompt given the existing Turn-1 diagram files in the workdir.
 */
export function buildFollowUpPrompt(
  task: EvalTask,
  mode: EvalMode,
  cliPath: string,
  followUpRequest: string,
): string {
  const artifact = mode === "cli" ? "diagram.json" : "diagram.yaml";
  const base = buildAgentPrompt(task, mode, cliPath);
  return `${base}

---

## Follow-up Request (Turn 2)

You already completed the initial task above and saved \`${artifact}\` and \`output.svg\` in the current working directory.
The user reviewed \`output.svg\` and now sends this follow-up instruction:

> ${followUpRequest}

Instructions for this follow-up turn:
1. Inspect the existing \`${artifact}\` (and its layout/crossings/bends via \`inspect\` / \`edge list\`).
2. Keep the pseudocode and language/granularity intact (do NOT delete or alter the code logic).
3. Refine the node layout and edge routing in \`${artifact}\` to satisfy the user's follow-up instruction — minimizing crossings, unnecessary detours, and visual clutter while keeping the control flow easy to scan top-to-bottom.
   (Note: you may reset or adjust previous manual node/edge overrides from Turn 1 if that produces a cleaner flow!)
4. Verify \`check ${artifact}\` passes with 0 issues and re-render \`output.svg\`.`;
}
