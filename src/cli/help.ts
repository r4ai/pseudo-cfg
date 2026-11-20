export const TOP_HELP = `pseudo-cfg — Declarative YAML & CLI for Control-Flow Graphs (AI Agents + Browser UI)

Usage:
  pseudo-cfg <command> [options]

Recommended AI + Human workflow (Declarative YAML + Browser UI):
  1. Write a single declarative \`diagram.yaml\` (source + optional layout.nodes / layout.edges)
  2. Inspect & audit:  pseudo-cfg inspect diagram.yaml --json  &&  pseudo-cfg check diagram.yaml
  3. Render SVG/PNG:   pseudo-cfg render diagram.yaml -o diagram.svg
  4. Hand off to UI:   pseudo-cfg open diagram.yaml          (opens browser UI with full layout!)
                       pseudo-cfg share diagram.yaml         (prints #spec=... share URL)
  5. After human UI tweaks, export back via UI "Download YAML" / "Copy YAML"

Inspect, verify, render & browser handoff (accepts .yaml, .json, raw source, or stdin):
  inspect [file]                        Inspect nodes, edges (sides & segments), diagnostics, and quality
  check [file]                          Verify diagnostics and layout/routing quality (exit 2 on issues)
  render [file] [-o out.svg|out.png]    Render standalone SVG (or PNG if rasterizer installed)
  open [file] [--url-only]              Open diagram (with layout!) in the browser UI for fine-tuning
  share [file] [--decode <url>]         Encode or decode a #spec=... (with layout) or #code=... URL
  export-yaml [file] [-o spec.yaml]     Export a workspace or source as a declarative YAML spec
  examples [name]                       List built-in examples or print one

Imperative workspace commands (optional, for scripted JSON workspace mutations):
  init [file] -o <file.json>            Create a workspace JSON from .yaml, source, --code, or --from-url
  source <file.json> [source-file]      Print source, or update source incrementally (keeps layout)
  set <file.json> [options]             Change --granularity (block|statement) or --lang (python|cuda)
  tidy <file.json>                      Reset manual node positions and edge overrides with auto-layout
  node list|move <file> ...             List or move nodes (--x/--y, --cx/--cy, --dx/--dy, --left-of/...)
  edge list|inspect|route|shift|points|reset <file> ...
                                        Inspect or adjust edge sides, segment lanes, waypoints, or reset
  apply <file.json> [ops.json|-]        Apply multiple node/edge/source edits atomically

Global options:
  --json                                Machine-readable JSON output (available on every command)
  -h, --help                            Show help for any command

Run 'pseudo-cfg help yaml' for the declarative YAML schema, or 'pseudo-cfg help <command>'.
`;

export const COMMAND_HELP: Record<string, string> = {
  yaml: `Declarative YAML Spec (.yaml / .yml) — Recommended for AI Agents & Browser UI Handoff

A single self-contained YAML file defines pseudocode plus optional layout overrides
layered on top of structured auto-layout. Pass any .yaml/.yml file directly to
'render', 'inspect', 'check', 'open', 'share', 'edge inspect', 'node list', or 'init'.

Schema:
  language: python | cuda          # optional (default: python)
  granularity: block | statement   # optional (default: block)
  source: |                        # required pseudocode block
    ...
  layout:                          # optional overrides on top of auto-layout
    snap: false                    # optional global 4px grid snapping
    nodes:                         # applied in declaration order
      "<node-selector>":           # node ID (n4), line (L10), exact label, or unique substring
        x: 100                     # absolute top-left x / y
        y: 200
        cx: 150                    # absolute center x / y
        cy: 220
        dx: 40                     # relative offset from current position
        dy: -20
        below: "<ref-node>"        # relational placement (also: above, leftOf, rightOf, alignX, alignY)
        gap: 48                    # spacing for relational placement (default: 40)
        snap: true
    edges:                         # applied after node positions are settled
      "<edge-selector>":           # handle (e4), ID pair (n3->n5:F), or labels ("if x -> y [F]")
        from: left                 # pin source side: top | right | bottom | left
        to: top                    # pin target side: top | right | bottom | left
        shift:                     # slide segment(s) sideways (single object or list)
          - segment: 1
            at: -80                # exact coordinate (x for vertical, y for horizontal) or delta: -40
        via:                       # intermediate orthogonal waypoints (anchors auto-added)
          - [420, 292]
          - [420, 220]
        points:                    # OR full orthogonal polyline [[x, y], ...]
          - [290, 292]
          - [420, 292]
`,

  open: `Usage:
  pseudo-cfg open [file|-] [options]

Open a diagram (.yaml, .json, or raw source) directly in the pseudo-cfg browser UI
with its full layout and edge overrides intact so a human can fine-tune it visually.

Options:
  --base <url>                Browser app URL (default: https://pseudo-cfg.r4ai.dev/)
  --url-only                  Print the URL without launching a browser
  --code-only                 Encode only source code (#code=...) without layout overrides
  -l, --lang <python|cuda>    Syntax (for raw source input)
  -g, --granularity <mode>    block | statement (for raw source input)
  --code <text>               Inline pseudocode string
  --example <name>            Open a built-in example
  --json                      Output { url, includesLayout, opened } as JSON (does not launch browser)
  -h, --help                  Show this help

Examples:
  pseudo-cfg open diagram.yaml
  pseudo-cfg open diagram.yaml --base http://localhost:3000/
  pseudo-cfg open diagram.yaml --url-only
`,

  init: `Usage:
  pseudo-cfg init [file|-] -o <workspace.json> [options]

Create a new workspace JSON file from a .yaml spec, pseudocode file, stdin, or share URL.

Options:
  -o, --out <path>            Output workspace JSON file (required; use '-' for stdout)
  -l, --lang <python|cuda>    Syntax (auto-detected from file extension; default: python)
  -g, --granularity <mode>    Node granularity: block (default) or statement
  --code <text>               Inline pseudocode string instead of a file
  --example <name>            Initialize from a built-in example (see 'pseudo-cfg examples')
  --from-url <url>            Initialize from a #spec=... (with layout) or #code=... share URL
  --json                      Output summary as JSON
  -h, --help                  Show this help
`,

  source: `Usage:
  pseudo-cfg source <workspace.json> [source-file|-] [options]

Print the workspace's current source code, or update it incrementally.
When updating, unchanged nodes keep their IDs, manual positions, and edge overrides
via LCS reconciliation and incremental push-down layout.

Options:
  --code <text>               New inline pseudocode string
  --json                      Output result as JSON
  -h, --help                  Show this help
`,

  set: `Usage:
  pseudo-cfg set <workspace.json> [options]

Update workspace granularity and/or syntax language.

Options:
  -g, --granularity <mode>    block | statement (re-runs auto-layout)
  -l, --lang <python|cuda>    python | cuda
  --json                      Output summary as JSON
  -h, --help                  Show this help
`,

  tidy: `Usage:
  pseudo-cfg tidy <workspace.json> [--json]

Discard all manual node positions and edge overrides and run a fresh structured layout.
`,

  inspect: `Usage:
  pseudo-cfg inspect [file|-] [options]

Inspect nodes (ID, kind, line, box, center, anchors), edges (handle, key, sides,
mode, segments), diagnostics, and layout/routing quality.
Accepts a .yaml spec, workspace .json file, raw source file, stdin, --code, or --example.

Options:
  -l, --lang <python|cuda>    Syntax (for raw source input)
  -g, --granularity <mode>    block | statement (for raw source input)
  --code <text>               Inline pseudocode string
  --example <name>            Inspect a built-in example
  --json                      Output full structured JSON
  -h, --help                  Show this help
`,

  check: `Usage:
  pseudo-cfg check [file|-] [options]

Audit diagnostics and routing quality (node overlaps, edges cutting through nodes,
collinear edge overlaps, unhopped crossings, covered labels).
Exits with code 0 when clean, or code 2 when issues are found.

Options:
  --strict                    Also fail (exit 2) on parser warnings (e.g. unreachable code)
  -l, --lang <python|cuda>    Syntax (for raw source input)
  -g, --granularity <mode>    block | statement (for raw source input)
  --code <text>               Inline pseudocode string
  --example <name>            Check a built-in example
  --json                      Output structured JSON report
  -h, --help                  Show this help
`,

  node: `Usage:
  pseudo-cfg node <subcommand> <file> [args...]

Subcommands:
  list <file.yaml|file.json>            List all nodes with positions, sizes, and centers
  move <workspace.json> <id...> [opts]  Move one or more nodes

Options for 'node move':
  --x <px>, --y <px>          Set absolute top-left coordinates
  --cx <px>, --cy <px>        Set absolute center coordinates
  --dx <px>, --dy <px>        Shift relative to current position (supports negative numbers)
  --below <refId>             Place below <refId> (centered on X)
  --above <refId>             Place above <refId> (centered on X)
  --right-of <refId>          Place to the right of <refId> (centered on Y)
  --left-of <refId>           Place to the left of <refId> (centered on Y)
  --align-x <refId>           Align center X with <refId>
  --align-y <refId>           Align center Y with <refId>
  --gap <px>                  Spacing for relational placement (default: 40)
  --snap                      Snap resulting coordinates to the 4px UI grid
  --json                      Output updated node info as JSON
`,

  edge: `Usage:
  pseudo-cfg edge <subcommand> <file> [args...]

Subcommands:
  list <file.yaml|file.json>                      List all edges with handles, sides, and segment counts
  inspect <file.yaml|file.json> <edge>            Show detailed points, segments, label position, and hops
  route <workspace.json> <edge> [opts]            Pin exit/entry sides (--from / --to)
  shift <workspace.json> <edge> <seg> [<delta>]   Slide a segment sideways (like dragging in the UI)
  points <workspace.json> <edge> [<pts>] [opts]   Set explicit orthogonal points or --via waypoints
  reset <workspace.json> [<edge> | --all]         Return edge(s) to automatic routing

Edge selector formats:
  e4             0-based edge handle from 'inspect' / 'edge list'
  n3->n5         Source and target node IDs (when unambiguous)
  n3->n5:F       With label (accepts T/F or True/False/next/done/raise/back)
  n3>n5:False    Exact internal edge key
`,

  apply: `Usage:
  pseudo-cfg apply <workspace.json> [ops.json|-] [options]

Apply a batch of operations atomically. If any operation fails, the workspace file
is not modified.

Options:
  --ops <json>                Inline JSON array of ops (or { "ops": [...] })
  --dry-run                   Validate and report result without writing the workspace file
  -r, --render <out.svg>      Also render the updated diagram to an SVG/PNG file
  --json                      Output result summary (including quality report) as JSON
  -h, --help                  Show this help
`,

  render: `Usage:
  pseudo-cfg render [file|-] [-o out.svg|out.png] [options]

Render a .yaml spec, workspace .json, or raw pseudocode directly to standalone SVG (default)
or PNG (when -o ends in .png or --format png, using resvg / rsvg-convert / inkscape / magick).

Options:
  -o, --out <path>            Output file path (prints SVG to stdout if omitted)
  -f, --format <svg|png>      Output format (inferred from -o extension; default: svg)
  --scale <number>            PNG rasterization scale factor (default: 2)
  -l, --lang <python|cuda>    Syntax (for raw source input)
  -g, --granularity <mode>    block | statement (for raw source input)
  --code <text>               Inline pseudocode string
  --example <name>            Render a built-in example
  --json                      Output metadata as JSON (when writing to -o)
  -h, --help                  Show this help
`,

  share: `Usage:
  pseudo-cfg share [file|-] [options]
  pseudo-cfg share --decode <url-or-hash> [--json]

Encode a diagram into a browser handoff URL:
- Uses #spec=... (preserving full YAML layout & edge overrides) when the input is a
  .yaml spec, has custom layout, or --with-layout is set.
- Uses #code=... (code only) for plain source files or when --code-only is passed.

Options:
  --base <url>                Base URL (default: https://pseudo-cfg.r4ai.dev/)
  --decode <url-or-hash>      Decode a #spec=... or #code=... share URL
  --with-layout               Always encode as #spec=... YAML
  --code-only                 Encode only source code as #code=...
  -l, --lang <python|cuda>    Syntax (for raw source input)
  -g, --granularity <mode>    block | statement (for raw source input)
  --code <text>               Inline pseudocode string
  --example <name>            Share a built-in example
  --json                      Output structured JSON
  -h, --help                  Show this help
`,

  "export-yaml": `Usage:
  pseudo-cfg export-yaml [file|-] [-o spec.yaml] [options]

Export a workspace JSON or raw source as a declarative YAML overlay spec.
`,

  examples: `Usage:
  pseudo-cfg examples [name] [--lang python|cuda] [--json]

List built-in example pseudocode snippets, or print the source of a named example.
`,
};
