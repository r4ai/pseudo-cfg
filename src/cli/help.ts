export const TOP_HELP = `pseudo-cfg — Control-flow graph CLI for humans and AI agents

Usage:
  pseudo-cfg <command> [options]

Workspace lifecycle:
  init [source-file] -o <file.json>     Create a workspace from file, stdin, --code, or --example
  source <file.json> [source-file]      Print source, or update source incrementally (keeps layout)
  set <file.json> [options]             Change --granularity (block|statement) or --lang (python|cuda)
  tidy <file.json>                      Reset manual node positions and edge overrides with auto-layout

Inspect & verify (accepts workspace .json, raw source file, or stdin):
  inspect [file]                        Show nodes, edges (sides & segments), diagnostics, and quality
  check [file]                          Verify diagnostics and layout/routing quality (exit 2 on issues)

Adjust nodes (workspace .json):
  node list <file.json>                 List nodes with coordinates, sizes, centers, and anchors
  node move <file.json> <id...>         Move nodes (--x/--y, --cx/--cy, --dx/--dy, --below/--left-of/...)

Adjust edges (workspace .json) — full UI parity:
  edge list <file.json>                 List edges with handles (e0..), sides, modes, and segments
  edge inspect <file.json> <edge>       Show points, segments (with shift axis/coord), labels, and hops
  edge route <file.json> <edge>         Pin exit/entry sides (--from / --to: top|right|bottom|left)
  edge shift <file.json> <edge> <seg>   Slide a segment sideways by <delta> or to --at <coord>
  edge points <file.json> <edge>        Set explicit orthogonal points or --via intermediate waypoints
  edge reset <file.json> [<edge>|--all] Return edge(s) to automatic routing

Batch edits & export:
  apply <file.json> [ops.json|-]        Apply multiple node/edge/source edits atomically
  render [file] [-o out.svg|out.png]    Render standalone SVG (or PNG if rasterizer installed)
  share [file] [--decode <url>]         Encode or decode a pseudo-cfg #code=... share URL
  examples [name]                       List built-in examples or print one

Global options:
  --json                                Machine-readable JSON output (available on every command)
  -h, --help                            Show help for any command

Edge selectors:
  Reference any edge by handle (e0), shorthand (n3->n5 or n3->n5:F), or exact key (n3>n5:False).

Typical AI-agent workflow:
  pseudo-cfg init algo.py -o algo.json
  pseudo-cfg inspect algo.json --json
  pseudo-cfg node move algo.json n5 --left-of n3 --gap 48
  pseudo-cfg edge route algo.json n3->n5:F --from left --to top
  pseudo-cfg edge shift algo.json e4 1 --at -60
  pseudo-cfg check algo.json
  pseudo-cfg render algo.json -o algo.svg

One-shot rendering (no workspace file needed):
  pseudo-cfg render algo.py -o algo.svg
  cat kernel.cu | pseudo-cfg render --lang cuda -o kernel.svg

Run 'pseudo-cfg help <command>' or 'pseudo-cfg <command> --help' for command details.
`;

export const COMMAND_HELP: Record<string, string> = {
  init: `Usage:
  pseudo-cfg init [source-file|-] -o <workspace.json> [options]

Create a new diagram workspace file from pseudocode.

Options:
  -o, --out <path>            Output workspace JSON file (required; use '-' for stdout)
  -l, --lang <python|cuda>    Syntax (auto-detected from file extension; default: python)
  -g, --granularity <mode>    Node granularity: block (default) or statement
  --code <text>               Inline pseudocode string instead of a file
  --example <name>            Initialize from a built-in example (see 'pseudo-cfg examples')
  --from-url <url>            Initialize from a pseudo-cfg #code=... share URL
  --json                      Output summary as JSON
  -h, --help                  Show this help

Examples:
  pseudo-cfg init algo.py -o algo.json
  pseudo-cfg init kernel.cu -o kernel.json --granularity statement
  pseudo-cfg init --example "Binary search" -o binary.json
  cat algo.py | pseudo-cfg init -o algo.json
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

Examples:
  pseudo-cfg source algo.json
  pseudo-cfg source algo.json algo.py
  cat updated.py | pseudo-cfg source algo.json -
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
Accepts a workspace JSON file, a raw source file, stdin, --code, or --example.

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
  pseudo-cfg node <subcommand> <workspace.json> [args...]

Subcommands:
  list <workspace.json>                 List all nodes with positions, sizes, and centers
  move <workspace.json> <id...> [opts]  Move one or more nodes

Options for 'node move':
  --x <px>, --y <px>          Set absolute top-left coordinates
  --cx <px>, --cy <px>        Set absolute center coordinates (handy for aligning varied widths)
  --dx <px>, --dy <px>        Shift relative to current position (supports negative numbers)
  --below <refId>             Place below <refId> (centered on X)
  --above <refId>             Place above <refId> (centered on X)
  --right-of <refId>          Place to the right of <refId> (centered on Y)
  --left-of <refId>           Place to the left of <refId> (centered on Y)
  --align-x <refId>           Align center X with <refId>
  --align-y <refId>           Align center Y with <refId>
  --gap <px>                  Spacing for --below/--above/--left-of/--right-of (default: 40)
  --snap                      Snap resulting coordinates to the 4px UI grid
  --json                      Output updated node info as JSON

Examples:
  pseudo-cfg node move algo.json n5 --left-of n3 --gap 48
  pseudo-cfg node move algo.json n4 n5 --dy 32
  pseudo-cfg node move algo.json n2 --cx 200 --y 160
`,

  edge: `Usage:
  pseudo-cfg edge <subcommand> <workspace.json> [args...]

Subcommands:
  list <workspace.json>                           List all edges with handles, sides, and segment counts
  inspect <workspace.json> <edge>                 Show detailed points, segments, label position, and hops
  route <workspace.json> <edge> [opts]            Pin exit/entry sides (--from / --to)
  shift <workspace.json> <edge> <seg> [<delta>]   Slide a segment sideways (like dragging in the UI)
  points <workspace.json> <edge> [<pts>] [opts]   Set explicit orthogonal points or --via waypoints
  reset <workspace.json> [<edge> | --all]         Return edge(s) to automatic routing

Edge selector formats:
  e4             0-based edge handle from 'inspect' / 'edge list'
  n3->n5         Source and target node IDs (when unambiguous)
  n3->n5:F       With label (accepts T/F or True/False/next/done/raise/back)
  n3>n5:False    Exact internal edge key

Options for 'edge route':
  --from <top|right|bottom|left>   Pin source exit side
  --to <top|right|bottom|left>     Pin target entry side

Options for 'edge shift':
  <delta>                          Signed pixel offset (+right/-left for V, +down/-up for H)
  --by <delta>                     Same as positional <delta>
  --at <coord>                     Move segment directly to x=<coord> (V) or y=<coord> (H)
  --snap                           Snap target coordinate to the 4px UI grid

Options for 'edge points':
  <points>                         Space/semicolon-separated "x,y" pairs or JSON array
  --via <points>                   Intermediate waypoints only (source & target anchors auto-added)
  --from <side>, --to <side>       Optional source/target sides for the custom route

Examples:
  pseudo-cfg edge inspect algo.json e4
  pseudo-cfg edge route algo.json n3->n5:F --from left --to top
  pseudo-cfg edge shift algo.json e4 1 -40
  pseudo-cfg edge shift algo.json e4 1 --at 420
  pseudo-cfg edge points algo.json e4 --via "420,292 420,220 483,220"
  pseudo-cfg edge reset algo.json e4
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

Operation schema:
  { "op": "source", "code": "..." }
  { "op": "granularity", "value": "block" | "statement" }
  { "op": "language", "value": "python" | "cuda", "code"?: "..." }
  { "op": "tidy" }
  { "op": "node.move", "id": "n5" | ["n5","n6"], "x"?, "y"?, "cx"?, "cy"?, "dx"?, "dy"?,
    "below"?, "above"?, "leftOf"?, "rightOf"?, "alignX"?, "alignY"?, "gap"?, "snap"? }
  { "op": "edge.route", "edge": "e4", "from"?, "to"? }
  { "op": "edge.shift", "edge": "e4", "segment": 1, "delta"?: 40, "at"?: 420, "snap"? }
  { "op": "edge.points", "edge": "e4", "points"?: [{ "x": 0, "y": 0 }], "via"?: [...], "from"?, "to"? }
  { "op": "edge.reset", "edge"?: "e4", "all"?: true }
`,

  render: `Usage:
  pseudo-cfg render [file|-] [-o out.svg|out.png] [options]

Render a workspace JSON file or raw pseudocode directly to standalone SVG (default)
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

Encode pseudocode (or a workspace's source) into a pseudo-cfg #code=... share URL,
or decode a share URL back into source code.

Options:
  --base <url>                Base URL (default: https://pseudo-cfg.r4ai.dev/)
  --decode <url-or-hash>      Decode a share URL or #code=... fragment
  -l, --lang <python|cuda>    Syntax (for raw source input)
  --code <text>               Inline pseudocode string
  --example <name>            Share a built-in example
  --json                      Output structured JSON
  -h, --help                  Show this help
`,

  examples: `Usage:
  pseudo-cfg examples [name] [--lang python|cuda] [--json]

List built-in example pseudocode snippets, or print the source of a named example.
`,
};
