import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { Granularity, Language } from "@/features/cfg/build-cfg";
import { diagramToSvg } from "@/features/diagram/export-image";
import { nodeBoxes, routeEdges } from "@/features/diagram/geometry";
import { EXAMPLES } from "@/features/workspace/sample";
import { sharedSource, shareUrl } from "@/features/workspace/share";
import { CliError, parseCliArgs, parseIntegerArg, parseNumberArg } from "./args";
import {
  formatDiagnostics,
  formatEdgeDetail,
  formatEdgeTable,
  formatInspection,
  formatNodeTable,
  formatQuality,
} from "./format";
import { COMMAND_HELP, TOP_HELP } from "./help";
import { rasterizeSvgToPng } from "./rasterize";
import {
  applyBatchOps,
  type BatchOp,
  type CliWorkspace,
  createWorkspace,
  inferLanguageFromPath,
  inspectRoutedEdge,
  inspectWorkspace,
  isSavedWorkspace,
  type MoveNodeOptions,
  moveNodes,
  normalizeWorkspace,
  parseGranularity,
  parseLanguage,
  parsePointList,
  parseSide,
  resetEdge,
  resolveEdge,
  routeEdgeSides,
  setEdgePoints,
  setWorkspaceGranularity,
  setWorkspaceLanguage,
  shiftEdgeSegment,
  tidyWorkspace,
  updateWorkspaceSource,
} from "./workspace-ops";

const DEFAULT_SHARE_BASE = "https://pseudo-cfg.r4ai.dev/";

export type CliIo = {
  cwd: string;
  readStdin: () => Promise<string>;
  stdinIsTTY: boolean;
  writeStdout: (chunk: string | Buffer) => void;
  writeStderr: (chunk: string) => void;
};

const DEFAULT_IO: CliIo = {
  cwd: process.cwd(),
  stdinIsTTY: Boolean(process.stdin.isTTY),
  readStdin: async () => {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    }
    return Buffer.concat(chunks).toString("utf8");
  },
  writeStdout: (chunk) => {
    process.stdout.write(chunk);
  },
  writeStderr: (chunk) => {
    process.stderr.write(chunk);
  },
};

export async function runCli(argv: string[], partialIo: Partial<CliIo> = {}): Promise<number> {
  const io: CliIo = { ...DEFAULT_IO, ...partialIo };
  const wantsJson = argv.includes("--json");

  try {
    return await dispatch(argv, io);
  } catch (error) {
    const code = error instanceof CliError ? error.code : 1;
    const message = error instanceof Error ? error.message : String(error);
    if (wantsJson) {
      io.writeStdout(`${JSON.stringify({ ok: false, error: message }, null, 2)}\n`);
    } else {
      io.writeStderr(`Error: ${message}\n`);
    }
    return code;
  }
}

async function dispatch(argv: string[], io: CliIo): Promise<number> {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === "-h" || cmd === "--help") {
    io.writeStdout(TOP_HELP);
    return 0;
  }
  if (cmd === "help") {
    const topic = rest[0];
    if (!topic) {
      io.writeStdout(TOP_HELP);
      return 0;
    }
    const text = COMMAND_HELP[topic];
    if (!text) throw new CliError(`Unknown command '${topic}'. Run 'pseudo-cfg --help' to list commands.`);
    io.writeStdout(text);
    return 0;
  }

  switch (cmd) {
    case "init":
      return cmdInit(rest, io);
    case "source":
      return cmdSource(rest, io);
    case "set":
      return cmdSet(rest, io);
    case "tidy":
      return cmdTidy(rest, io);
    case "inspect":
      return cmdInspect(rest, io);
    case "check":
      return cmdCheck(rest, io);
    case "node":
      return cmdNode(rest, io);
    case "edge":
      return cmdEdge(rest, io);
    case "apply":
      return cmdApply(rest, io);
    case "render":
      return cmdRender(rest, io);
    case "share":
      return cmdShare(rest, io);
    case "examples":
      return cmdExamples(rest, io);
    default:
      throw new CliError(`Unknown command '${cmd}'. Run 'pseudo-cfg --help' to see available commands.`);
  }
}

async function cmdInit(argv: string[], io: CliIo): Promise<number> {
  const { positionals, values } = parseCliArgs(argv, {
    out: { type: "string", short: "o" },
    lang: { type: "string", short: "l" },
    granularity: { type: "string", short: "g" },
    code: { type: "string" },
    example: { type: "string" },
    "from-url": { type: "string" },
    json: { type: "boolean" },
    help: { type: "boolean", short: "h" },
  });
  if (values.help) {
    io.writeStdout(COMMAND_HELP.init as string);
    return 0;
  }
  if (!values.out) {
    throw new CliError("Missing required option '-o <workspace.json>'. Run 'pseudo-cfg init --help'.");
  }

  const { source, language } = await resolveSourceInput(
    positionals[0],
    {
      ...(values.code !== undefined ? { code: values.code } : {}),
      ...(values.example !== undefined ? { example: values.example } : {}),
      ...(values["from-url"] !== undefined ? { fromUrl: values["from-url"] } : {}),
      ...(values.lang !== undefined ? { lang: values.lang } : {}),
    },
    io,
  );
  const granularity: Granularity = values.granularity ? parseGranularity(values.granularity) : "block";
  const { workspace, diagnostics } = createWorkspace(source, { language, granularity });

  if (values.out === "-") {
    io.writeStdout(`${JSON.stringify(workspace, null, 2)}\n`);
    return 0;
  }

  const outPath = resolve(io.cwd, values.out);
  await writeWorkspaceFile(outPath, workspace);
  const info = inspectWorkspace(workspace);
  if (values.json) {
    io.writeStdout(
      `${JSON.stringify({ ok: true, file: values.out, language, granularity, nodes: info.nodes.length, edges: info.edges.length, diagnostics, quality: info.quality }, null, 2)}\n`,
    );
  } else {
    io.writeStdout(
      `Created ${values.out} (${language}, ${granularity}): ${info.nodes.length} nodes, ${info.edges.length} edges, ${diagnostics.length} diagnostics\n`,
    );
  }
  return 0;
}

async function cmdSource(argv: string[], io: CliIo): Promise<number> {
  const { positionals, values } = parseCliArgs(argv, {
    code: { type: "string" },
    json: { type: "boolean" },
    help: { type: "boolean", short: "h" },
  });
  if (values.help) {
    io.writeStdout(COMMAND_HELP.source as string);
    return 0;
  }
  const wsArg = positionals[0];
  if (!wsArg) throw new CliError("Missing <workspace.json>. Run 'pseudo-cfg source --help'.");
  const wsPath = resolve(io.cwd, wsArg);
  const workspace = await readWorkspaceFile(wsPath);

  const srcArg = positionals[1];
  if (srcArg === undefined && values.code === undefined) {
    if (values.json) {
      io.writeStdout(
        `${JSON.stringify({ ok: true, language: workspace.language, source: workspace.source }, null, 2)}\n`,
      );
    } else {
      io.writeStdout(workspace.source.endsWith("\n") ? workspace.source : `${workspace.source}\n`);
    }
    return 0;
  }

  const nextSource =
    values.code !== undefined
      ? values.code
      : srcArg === "-"
        ? await io.readStdin()
        : await readFile(resolve(io.cwd, srcArg as string), "utf8");

  const { workspace: updated, diagnostics, relaid } = updateWorkspaceSource(workspace, nextSource);
  await writeWorkspaceFile(wsPath, updated);
  const info = inspectWorkspace(updated);
  if (values.json) {
    io.writeStdout(
      `${JSON.stringify({ ok: true, file: wsArg, relaid, nodes: info.nodes.length, edges: info.edges.length, diagnostics, quality: info.quality }, null, 2)}\n`,
    );
  } else {
    const layoutNote = relaid ? "full re-layout (mostly replaced)" : "incremental layout preserved";
    io.writeStdout(
      `Updated ${wsArg} (${layoutNote}): ${info.nodes.length} nodes, ${info.edges.length} edges, ${diagnostics.length} diagnostics\n`,
    );
  }
  return 0;
}

async function cmdSet(argv: string[], io: CliIo): Promise<number> {
  const { positionals, values } = parseCliArgs(argv, {
    granularity: { type: "string", short: "g" },
    lang: { type: "string", short: "l" },
    json: { type: "boolean" },
    help: { type: "boolean", short: "h" },
  });
  if (values.help) {
    io.writeStdout(COMMAND_HELP.set as string);
    return 0;
  }
  const wsArg = positionals[0];
  if (!wsArg) throw new CliError("Missing <workspace.json>. Run 'pseudo-cfg set --help'.");
  if (!values.granularity && !values.lang) {
    throw new CliError("Specify --granularity <block|statement> and/or --lang <python|cuda>.");
  }

  const wsPath = resolve(io.cwd, wsArg);
  let workspace = await readWorkspaceFile(wsPath);
  if (values.lang) {
    workspace = setWorkspaceLanguage(workspace, parseLanguage(values.lang)).workspace;
  }
  if (values.granularity) {
    workspace = setWorkspaceGranularity(workspace, parseGranularity(values.granularity)).workspace;
  }
  await writeWorkspaceFile(wsPath, workspace);
  const info = inspectWorkspace(workspace);
  if (values.json) {
    io.writeStdout(
      `${JSON.stringify({ ok: true, file: wsArg, language: workspace.language, granularity: workspace.granularity, nodes: info.nodes.length, edges: info.edges.length, diagnostics: info.diagnostics }, null, 2)}\n`,
    );
  } else {
    io.writeStdout(
      `Updated ${wsArg}: language=${workspace.language}, granularity=${workspace.granularity} (${info.nodes.length} nodes, ${info.edges.length} edges)\n`,
    );
  }
  return 0;
}

async function cmdTidy(argv: string[], io: CliIo): Promise<number> {
  const { positionals, values } = parseCliArgs(argv, {
    json: { type: "boolean" },
    help: { type: "boolean", short: "h" },
  });
  if (values.help) {
    io.writeStdout(COMMAND_HELP.tidy as string);
    return 0;
  }
  const wsArg = positionals[0];
  if (!wsArg) throw new CliError("Missing <workspace.json>. Run 'pseudo-cfg tidy --help'.");
  const wsPath = resolve(io.cwd, wsArg);
  const workspace = tidyWorkspace(await readWorkspaceFile(wsPath));
  await writeWorkspaceFile(wsPath, workspace);
  const info = inspectWorkspace(workspace);
  if (values.json) {
    io.writeStdout(`${JSON.stringify({ ok: true, file: wsArg, quality: info.quality }, null, 2)}\n`);
  } else {
    io.writeStdout(
      `Tidied ${wsArg}: reset positions and edge overrides (${info.nodes.length} nodes, ${info.edges.length} edges, ${info.quality.issueCount} issues)\n`,
    );
  }
  return 0;
}

async function cmdInspect(argv: string[], io: CliIo): Promise<number> {
  const { positionals, values } = parseCliArgs(argv, {
    lang: { type: "string", short: "l" },
    granularity: { type: "string", short: "g" },
    code: { type: "string" },
    example: { type: "string" },
    json: { type: "boolean" },
    help: { type: "boolean", short: "h" },
  });
  if (values.help) {
    io.writeStdout(COMMAND_HELP.inspect as string);
    return 0;
  }

  const { workspace, label } = await loadAnyDiagram(
    positionals[0],
    {
      ...(values.lang !== undefined ? { lang: values.lang } : {}),
      ...(values.granularity !== undefined ? { granularity: values.granularity } : {}),
      ...(values.code !== undefined ? { code: values.code } : {}),
      ...(values.example !== undefined ? { example: values.example } : {}),
    },
    io,
  );
  const info = inspectWorkspace(workspace);
  if (values.json) {
    io.writeStdout(`${JSON.stringify({ ok: true, ...info }, null, 2)}\n`);
  } else {
    io.writeStdout(formatInspection(info, label));
  }
  return 0;
}

async function cmdCheck(argv: string[], io: CliIo): Promise<number> {
  const { positionals, values } = parseCliArgs(argv, {
    strict: { type: "boolean" },
    lang: { type: "string", short: "l" },
    granularity: { type: "string", short: "g" },
    code: { type: "string" },
    example: { type: "string" },
    json: { type: "boolean" },
    help: { type: "boolean", short: "h" },
  });
  if (values.help) {
    io.writeStdout(COMMAND_HELP.check as string);
    return 0;
  }

  const { workspace, label } = await loadAnyDiagram(
    positionals[0],
    {
      ...(values.lang !== undefined ? { lang: values.lang } : {}),
      ...(values.granularity !== undefined ? { granularity: values.granularity } : {}),
      ...(values.code !== undefined ? { code: values.code } : {}),
      ...(values.example !== undefined ? { example: values.example } : {}),
    },
    io,
  );
  const info = inspectWorkspace(workspace);
  const errorDiagnostics = info.diagnostics.filter((d) => d.severity === "error");
  const warningDiagnostics = info.diagnostics.filter((d) => d.severity === "warning");
  const diagFailed = errorDiagnostics.length > 0 || (Boolean(values.strict) && warningDiagnostics.length > 0);
  const passed = info.quality.ok && !diagFailed;

  if (values.json) {
    io.writeStdout(
      `${JSON.stringify({ ok: passed, diagnostics: info.diagnostics, quality: info.quality }, null, 2)}\n`,
    );
  } else {
    const lines: string[] = [
      `${passed ? "PASS" : "FAIL"}${label ? ` ${label}` : ""}: ${errorDiagnostics.length} errors, ${warningDiagnostics.length} warnings, ${info.quality.issueCount} layout issues`,
    ];
    if (info.diagnostics.length > 0) {
      lines.push("Diagnostics:", ...formatDiagnostics(info.diagnostics));
    }
    lines.push("Quality:", ...formatQuality(info.quality));
    io.writeStdout(`${lines.join("\n")}\n`);
  }
  return passed ? 0 : 2;
}

async function cmdNode(argv: string[], io: CliIo): Promise<number> {
  const [sub, ...rest] = argv;
  if (!sub || sub === "-h" || sub === "--help") {
    io.writeStdout(COMMAND_HELP.node as string);
    return 0;
  }

  if (sub === "list" || sub === "ls") {
    const { positionals, values } = parseCliArgs(rest, {
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    });
    if (values.help) {
      io.writeStdout(COMMAND_HELP.node as string);
      return 0;
    }
    const wsArg = positionals[0];
    if (!wsArg) throw new CliError("Missing <workspace.json>. Run 'pseudo-cfg node --help'.");
    const workspace = await readWorkspaceFile(resolve(io.cwd, wsArg));
    const info = inspectWorkspace(workspace);
    if (values.json) {
      io.writeStdout(`${JSON.stringify({ ok: true, nodes: info.nodes }, null, 2)}\n`);
    } else {
      io.writeStdout(`${formatNodeTable(info.nodes).join("\n")}\n`);
    }
    return 0;
  }

  if (sub === "move" || sub === "mv") {
    const { positionals, values } = parseCliArgs(rest, {
      x: { type: "number" },
      y: { type: "number" },
      cx: { type: "number" },
      cy: { type: "number" },
      dx: { type: "number" },
      dy: { type: "number" },
      below: { type: "string" },
      above: { type: "string" },
      "left-of": { type: "string" },
      "right-of": { type: "string" },
      "align-x": { type: "string" },
      "align-y": { type: "string" },
      gap: { type: "number" },
      snap: { type: "boolean" },
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    });
    if (values.help) {
      io.writeStdout(COMMAND_HELP.node as string);
      return 0;
    }
    const [wsArg, ...nodeIds] = positionals;
    if (!wsArg) throw new CliError("Missing <workspace.json> <nodeId...>. Run 'pseudo-cfg node --help'.");

    const wsPath = resolve(io.cwd, wsArg);
    const workspace = await readWorkspaceFile(wsPath);
    const moveOpts: MoveNodeOptions = {
      ...(values.x !== undefined ? { x: values.x } : {}),
      ...(values.y !== undefined ? { y: values.y } : {}),
      ...(values.cx !== undefined ? { cx: values.cx } : {}),
      ...(values.cy !== undefined ? { cy: values.cy } : {}),
      ...(values.dx !== undefined ? { dx: values.dx } : {}),
      ...(values.dy !== undefined ? { dy: values.dy } : {}),
      ...(values.below !== undefined ? { below: values.below } : {}),
      ...(values.above !== undefined ? { above: values.above } : {}),
      ...(values["left-of"] !== undefined ? { leftOf: values["left-of"] } : {}),
      ...(values["right-of"] !== undefined ? { rightOf: values["right-of"] } : {}),
      ...(values["align-x"] !== undefined ? { alignX: values["align-x"] } : {}),
      ...(values["align-y"] !== undefined ? { alignY: values["align-y"] } : {}),
      ...(values.gap !== undefined ? { gap: values.gap } : {}),
      ...(values.snap !== undefined ? { snap: values.snap } : {}),
    };

    const { workspace: updated, moved } = moveNodes(workspace, nodeIds, moveOpts);
    await writeWorkspaceFile(wsPath, updated);
    const quality = inspectWorkspace(updated).quality;
    if (values.json) {
      io.writeStdout(`${JSON.stringify({ ok: true, moved, quality }, null, 2)}\n`);
    } else {
      io.writeStdout(`Moved ${moved.length} node${moved.length === 1 ? "" : "s"}:\n`);
      io.writeStdout(`${formatNodeTable(moved).join("\n")}\n`);
      if (!quality.ok) {
        io.writeStdout(`Quality warning (${quality.issueCount} issues):\n`);
        io.writeStdout(`${formatQuality(quality).join("\n")}\n`);
      }
    }
    return 0;
  }

  throw new CliError(`Unknown 'node' subcommand '${sub}'. Expected: list, move.`);
}

async function cmdEdge(argv: string[], io: CliIo): Promise<number> {
  const [sub, ...rest] = argv;
  if (!sub || sub === "-h" || sub === "--help") {
    io.writeStdout(COMMAND_HELP.edge as string);
    return 0;
  }

  if (sub === "list" || sub === "ls") {
    const { positionals, values } = parseCliArgs(rest, {
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    });
    if (values.help) {
      io.writeStdout(COMMAND_HELP.edge as string);
      return 0;
    }
    const wsArg = positionals[0];
    if (!wsArg) throw new CliError("Missing <workspace.json>. Run 'pseudo-cfg edge --help'.");
    const workspace = await readWorkspaceFile(resolve(io.cwd, wsArg));
    const info = inspectWorkspace(workspace);
    if (values.json) {
      io.writeStdout(`${JSON.stringify({ ok: true, edges: info.edges }, null, 2)}\n`);
    } else {
      io.writeStdout(`${formatEdgeTable(info.edges).join("\n")}\n`);
    }
    return 0;
  }

  if (sub === "inspect" || sub === "show") {
    const { positionals, values } = parseCliArgs(rest, {
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    });
    if (values.help) {
      io.writeStdout(COMMAND_HELP.edge as string);
      return 0;
    }
    const [wsArg, selector] = positionals;
    if (!wsArg || !selector) {
      throw new CliError("Usage: pseudo-cfg edge inspect <workspace.json> <edge>");
    }
    const workspace = await readWorkspaceFile(resolve(io.cwd, wsArg));
    const boxes = nodeBoxes(workspace.cfg, workspace.positions);
    const routed = routeEdges(workspace.cfg, boxes, workspace.edges);
    const { edge, index } = resolveEdge(routed, selector);
    const detail = inspectRoutedEdge(edge, index, workspace.edges);
    if (values.json) {
      io.writeStdout(`${JSON.stringify({ ok: true, edge: detail }, null, 2)}\n`);
    } else {
      io.writeStdout(formatEdgeDetail(detail));
    }
    return 0;
  }

  if (sub === "route") {
    const { positionals, values } = parseCliArgs(rest, {
      from: { type: "string" },
      to: { type: "string" },
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    });
    if (values.help) {
      io.writeStdout(COMMAND_HELP.edge as string);
      return 0;
    }
    const [wsArg, selector] = positionals;
    if (!wsArg || !selector) {
      throw new CliError("Usage: pseudo-cfg edge route <workspace.json> <edge> [--from side] [--to side]");
    }
    const wsPath = resolve(io.cwd, wsArg);
    const workspace = await readWorkspaceFile(wsPath);
    const { workspace: updated, edge } = routeEdgeSides(workspace, selector, {
      ...(values.from !== undefined ? { from: parseSide(values.from) } : {}),
      ...(values.to !== undefined ? { to: parseSide(values.to) } : {}),
    });
    await writeWorkspaceFile(wsPath, updated);
    const quality = inspectWorkspace(updated).quality;
    if (values.json) {
      io.writeStdout(`${JSON.stringify({ ok: true, edge, quality }, null, 2)}\n`);
    } else {
      io.writeStdout(`Updated ${formatEdgeDetail(edge)}`);
    }
    return 0;
  }

  if (sub === "shift") {
    const { positionals, values } = parseCliArgs(rest, {
      by: { type: "number" },
      at: { type: "number" },
      snap: { type: "boolean" },
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    });
    if (values.help) {
      io.writeStdout(COMMAND_HELP.edge as string);
      return 0;
    }
    const [wsArg, selector, segRaw, deltaRaw] = positionals;
    if (!wsArg || !selector || segRaw === undefined) {
      throw new CliError(
        "Usage: pseudo-cfg edge shift <workspace.json> <edge> <segmentIndex> (<delta> | --at <coord>)",
      );
    }
    const segIndex = parseIntegerArg("segment index", segRaw);
    const delta = values.by ?? (deltaRaw !== undefined ? parseNumberArg("delta", deltaRaw) : undefined);

    const wsPath = resolve(io.cwd, wsArg);
    const workspace = await readWorkspaceFile(wsPath);
    const { workspace: updated, edge } = shiftEdgeSegment(workspace, selector, segIndex, {
      ...(delta !== undefined ? { delta } : {}),
      ...(values.at !== undefined ? { at: values.at } : {}),
      ...(values.snap !== undefined ? { snap: values.snap } : {}),
    });
    await writeWorkspaceFile(wsPath, updated);
    const quality = inspectWorkspace(updated).quality;
    if (values.json) {
      io.writeStdout(`${JSON.stringify({ ok: true, edge, quality }, null, 2)}\n`);
    } else {
      io.writeStdout(`Updated ${formatEdgeDetail(edge)}`);
    }
    return 0;
  }

  if (sub === "points") {
    const { positionals, values } = parseCliArgs(rest, {
      via: { type: "string" },
      from: { type: "string" },
      to: { type: "string" },
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    });
    if (values.help) {
      io.writeStdout(COMMAND_HELP.edge as string);
      return 0;
    }
    const [wsArg, selector, ...pointArgs] = positionals;
    if (!wsArg || !selector) {
      throw new CliError(
        "Usage: pseudo-cfg edge points <workspace.json> <edge> (<x,y ...> | --via <x,y ...>)",
      );
    }
    const wsPath = resolve(io.cwd, wsArg);
    const workspace = await readWorkspaceFile(wsPath);
    const points = pointArgs.length > 0 ? parsePointList(pointArgs.join(" ")) : undefined;
    const via = values.via !== undefined ? parsePointList(values.via) : undefined;
    const { workspace: updated, edge } = setEdgePoints(workspace, selector, {
      ...(points !== undefined ? { points } : {}),
      ...(via !== undefined ? { via } : {}),
      ...(values.from !== undefined ? { from: parseSide(values.from) } : {}),
      ...(values.to !== undefined ? { to: parseSide(values.to) } : {}),
    });
    await writeWorkspaceFile(wsPath, updated);
    const quality = inspectWorkspace(updated).quality;
    if (values.json) {
      io.writeStdout(`${JSON.stringify({ ok: true, edge, quality }, null, 2)}\n`);
    } else {
      io.writeStdout(`Updated ${formatEdgeDetail(edge)}`);
    }
    return 0;
  }

  if (sub === "reset") {
    const { positionals, values } = parseCliArgs(rest, {
      all: { type: "boolean" },
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    });
    if (values.help) {
      io.writeStdout(COMMAND_HELP.edge as string);
      return 0;
    }
    const [wsArg, selector] = positionals;
    if (!wsArg) throw new CliError("Usage: pseudo-cfg edge reset <workspace.json> (<edge> | --all)");
    if (!values.all && !selector) {
      throw new CliError("Specify an edge selector or --all.");
    }
    const wsPath = resolve(io.cwd, wsArg);
    const workspace = await readWorkspaceFile(wsPath);
    const result = resetEdge(workspace, values.all ? { all: true } : (selector as string));
    await writeWorkspaceFile(wsPath, result.workspace);
    const quality = inspectWorkspace(result.workspace).quality;
    if (values.json) {
      io.writeStdout(
        `${JSON.stringify({ ok: true, resetCount: result.resetCount, ...(result.edge ? { edge: result.edge } : {}), quality }, null, 2)}\n`,
      );
    } else if (result.edge) {
      io.writeStdout(`Reset ${formatEdgeDetail(result.edge)}`);
    } else {
      io.writeStdout(
        `Reset ${result.resetCount} edge override${result.resetCount === 1 ? "" : "s"} to automatic routing.\n`,
      );
    }
    return 0;
  }

  throw new CliError(
    `Unknown 'edge' subcommand '${sub}'. Expected: list, inspect, route, shift, points, reset.`,
  );
}

async function cmdApply(argv: string[], io: CliIo): Promise<number> {
  const { positionals, values } = parseCliArgs(argv, {
    ops: { type: "string" },
    "dry-run": { type: "boolean" },
    render: { type: "string", short: "r" },
    json: { type: "boolean" },
    help: { type: "boolean", short: "h" },
  });
  if (values.help) {
    io.writeStdout(COMMAND_HELP.apply as string);
    return 0;
  }
  const [wsArg, opsFile] = positionals;
  if (!wsArg) throw new CliError("Usage: pseudo-cfg apply <workspace.json> [ops.json|-] [--ops <json>]");

  let rawOps: string;
  if (values.ops !== undefined) {
    rawOps = values.ops;
  } else if (opsFile && opsFile !== "-") {
    rawOps = await readFile(resolve(io.cwd, opsFile), "utf8");
  } else if (opsFile === "-" || !io.stdinIsTTY) {
    rawOps = await io.readStdin();
  } else {
    throw new CliError("Provide operations via a JSON file, stdin, or --ops '<json>'.");
  }

  const ops = parseBatchOpsJson(rawOps);
  const wsPath = resolve(io.cwd, wsArg);
  const workspace = await readWorkspaceFile(wsPath);
  const { workspace: updated, applied } = applyBatchOps(workspace, ops);

  if (!values["dry-run"]) {
    await writeWorkspaceFile(wsPath, updated);
    if (values.render) {
      await renderToTarget(updated, values.render, undefined, 2, io);
    }
  }

  const info = inspectWorkspace(updated);
  if (values.json) {
    io.writeStdout(
      `${JSON.stringify({ ok: true, applied, dryRun: Boolean(values["dry-run"]), ...(values.render && !values["dry-run"] ? { rendered: values.render } : {}), diagnostics: info.diagnostics, quality: info.quality }, null, 2)}\n`,
    );
  } else {
    const prefix = values["dry-run"] ? "[dry-run] Validated" : "Applied";
    const renderNote = values.render && !values["dry-run"] ? `, rendered ${values.render}` : "";
    io.writeStdout(
      `${prefix} ${applied} op${applied === 1 ? "" : "s"} to ${wsArg}${renderNote} (${info.nodes.length} nodes, ${info.edges.length} edges, ${info.quality.issueCount} issues)\n`,
    );
  }
  return 0;
}

async function cmdRender(argv: string[], io: CliIo): Promise<number> {
  const { positionals, values } = parseCliArgs(argv, {
    out: { type: "string", short: "o" },
    format: { type: "string", short: "f" },
    scale: { type: "number" },
    lang: { type: "string", short: "l" },
    granularity: { type: "string", short: "g" },
    code: { type: "string" },
    example: { type: "string" },
    json: { type: "boolean" },
    help: { type: "boolean", short: "h" },
  });
  if (values.help) {
    io.writeStdout(COMMAND_HELP.render as string);
    return 0;
  }
  const scale = values.scale ?? 2;
  if (scale <= 0) throw new CliError("--scale must be a positive number.");

  const { workspace } = await loadAnyDiagram(
    positionals[0],
    {
      ...(values.lang !== undefined ? { lang: values.lang } : {}),
      ...(values.granularity !== undefined ? { granularity: values.granularity } : {}),
      ...(values.code !== undefined ? { code: values.code } : {}),
      ...(values.example !== undefined ? { example: values.example } : {}),
    },
    io,
  );

  const fmt = resolveRenderFormat(values.format, values.out);
  if (!values.out || values.out === "-") {
    const svg = diagramToSvg(workspace.cfg, workspace.positions, workspace.edges);
    if (fmt === "png") {
      const png = await rasterizeSvgToPng(svg, scale);
      io.writeStdout(png);
    } else {
      io.writeStdout(`${svg}\n`);
    }
    return 0;
  }

  const bytes = await renderToTarget(workspace, values.out, fmt, scale, io);
  if (values.json) {
    io.writeStdout(`${JSON.stringify({ ok: true, out: values.out, format: fmt, bytes }, null, 2)}\n`);
  } else {
    io.writeStdout(`Wrote ${fmt.toUpperCase()} to ${values.out} (${bytes} bytes)\n`);
  }
  return 0;
}

async function cmdShare(argv: string[], io: CliIo): Promise<number> {
  const { positionals, values } = parseCliArgs(argv, {
    base: { type: "string" },
    decode: { type: "string" },
    lang: { type: "string", short: "l" },
    code: { type: "string" },
    example: { type: "string" },
    json: { type: "boolean" },
    help: { type: "boolean", short: "h" },
  });
  if (values.help) {
    io.writeStdout(COMMAND_HELP.share as string);
    return 0;
  }

  if (values.decode !== undefined) {
    const raw = values.decode.trim();
    const hash = raw.startsWith("#") ? raw : new URL(raw).hash;
    const decoded = sharedSource(hash);
    if (!decoded) throw new CliError("Invalid or corrupt pseudo-cfg share URL / fragment.");
    if (values.json) {
      io.writeStdout(`${JSON.stringify({ ok: true, ...decoded }, null, 2)}\n`);
    } else {
      io.writeStdout(decoded.source.endsWith("\n") ? decoded.source : `${decoded.source}\n`);
    }
    return 0;
  }

  const { workspace } = await loadAnyDiagram(
    positionals[0],
    {
      ...(values.lang !== undefined ? { lang: values.lang } : {}),
      ...(values.code !== undefined ? { code: values.code } : {}),
      ...(values.example !== undefined ? { example: values.example } : {}),
    },
    io,
  );
  const url = shareUrl(
    { source: workspace.source, language: workspace.language },
    values.base ?? DEFAULT_SHARE_BASE,
  );
  if (values.json) {
    io.writeStdout(`${JSON.stringify({ ok: true, url, language: workspace.language }, null, 2)}\n`);
  } else {
    io.writeStdout(`${url}\n`);
  }
  return 0;
}

async function cmdExamples(argv: string[], io: CliIo): Promise<number> {
  const { positionals, values } = parseCliArgs(argv, {
    lang: { type: "string", short: "l" },
    json: { type: "boolean" },
    help: { type: "boolean", short: "h" },
  });
  if (values.help) {
    io.writeStdout(COMMAND_HELP.examples as string);
    return 0;
  }
  const langFilter = values.lang ? parseLanguage(values.lang) : undefined;
  const name = positionals.join(" ").trim();
  if (name) {
    const example = findExample(name);
    if (values.json) {
      io.writeStdout(`${JSON.stringify({ ok: true, ...example }, null, 2)}\n`);
    } else {
      io.writeStdout(example.source);
    }
    return 0;
  }

  const filtered = langFilter ? EXAMPLES.filter((e) => e.language === langFilter) : EXAMPLES;
  if (values.json) {
    io.writeStdout(
      `${JSON.stringify({ ok: true, examples: filtered.map(({ name: n, language }) => ({ name: n, language })) }, null, 2)}\n`,
    );
  } else {
    for (const e of filtered) {
      io.writeStdout(`  [${e.language.padEnd(6)}] ${e.name}\n`);
    }
  }
  return 0;
}

async function renderToTarget(
  workspace: CliWorkspace,
  outArg: string,
  explicitFormat: "svg" | "png" | undefined,
  scale: number,
  io: CliIo,
): Promise<number> {
  const format = explicitFormat ?? resolveRenderFormat(undefined, outArg);
  const outPath = resolve(io.cwd, outArg);
  await mkdir(dirname(outPath), { recursive: true });
  const svg = diagramToSvg(workspace.cfg, workspace.positions, workspace.edges);
  if (format === "png") {
    const png = await rasterizeSvgToPng(svg, scale);
    await writeFile(outPath, png);
    return png.byteLength;
  }
  await writeFile(outPath, svg, "utf8");
  return Buffer.byteLength(svg, "utf8");
}

function resolveRenderFormat(explicit: string | undefined, outPath: string | undefined): "svg" | "png" {
  if (explicit) {
    if (explicit === "svg" || explicit === "png") return explicit;
    throw new CliError(`Invalid format '${explicit}'. Expected 'svg' or 'png'.`);
  }
  if (outPath && outPath.toLowerCase().endsWith(".png")) return "png";
  return "svg";
}

async function readWorkspaceFile(filePath: string): Promise<CliWorkspace> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      throw new CliError(`Workspace file not found: ${filePath}`);
    }
    throw new CliError(`Could not read workspace file ${filePath}: ${err.message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new CliError(`File is not valid JSON: ${filePath}`);
  }
  if (!isSavedWorkspace(parsed)) {
    throw new CliError(`File is not a valid pseudo-cfg workspace JSON: ${filePath}`);
  }
  return normalizeWorkspace(parsed);
}

async function writeWorkspaceFile(filePath: string, workspace: CliWorkspace): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(workspace, null, 2)}\n`, "utf8");
}

async function resolveSourceInput(
  fileArg: string | undefined,
  options: { code?: string; example?: string; fromUrl?: string; lang?: string },
  io: CliIo,
): Promise<{ source: string; language: Language }> {
  if (options.fromUrl !== undefined) {
    const raw = options.fromUrl.trim();
    const hash = raw.startsWith("#") ? raw : new URL(raw).hash;
    const decoded = sharedSource(hash);
    if (!decoded) throw new CliError("Invalid or corrupt pseudo-cfg share URL.");
    return {
      source: decoded.source,
      language: options.lang ? parseLanguage(options.lang) : decoded.language,
    };
  }
  if (options.example !== undefined) {
    const example = findExample(options.example);
    return {
      source: example.source,
      language: options.lang ? parseLanguage(options.lang) : example.language,
    };
  }
  if (options.code !== undefined) {
    return {
      source: options.code,
      language: options.lang ? parseLanguage(options.lang) : "python",
    };
  }
  if (fileArg && fileArg !== "-") {
    const fullPath = resolve(io.cwd, fileArg);
    const source = await readFile(fullPath, "utf8");
    const language = options.lang ? parseLanguage(options.lang) : inferLanguageFromPath(fileArg);
    return { source, language };
  }
  if (fileArg === "-" || !io.stdinIsTTY) {
    const source = await io.readStdin();
    const language = options.lang ? parseLanguage(options.lang) : "python";
    return { source, language };
  }
  throw new CliError("No input source provided. Pass a source file, pipe stdin, or use --code / --example.");
}

async function loadAnyDiagram(
  fileArg: string | undefined,
  options: { lang?: string; granularity?: string; code?: string; example?: string },
  io: CliIo,
): Promise<{ workspace: CliWorkspace; label?: string }> {
  const granularity: Granularity = options.granularity ? parseGranularity(options.granularity) : "block";

  if (options.example !== undefined) {
    const ex = findExample(options.example);
    const language = options.lang ? parseLanguage(options.lang) : ex.language;
    return { workspace: createWorkspace(ex.source, { language, granularity }).workspace, label: ex.name };
  }
  if (options.code !== undefined) {
    const language = options.lang ? parseLanguage(options.lang) : "python";
    return {
      workspace: createWorkspace(options.code, { language, granularity }).workspace,
      label: "<inline>",
    };
  }

  let raw: string;
  let label: string;
  let extPath: string | undefined;
  if (fileArg && fileArg !== "-") {
    const fullPath = resolve(io.cwd, fileArg);
    raw = await readFile(fullPath, "utf8");
    label = fileArg;
    extPath = fileArg;
  } else if (fileArg === "-" || !io.stdinIsTTY) {
    raw = await io.readStdin();
    label = "<stdin>";
  } else {
    throw new CliError(
      "No input provided. Pass a workspace .json file, a source file, stdin, or --code / --example.",
    );
  }

  // Try parsing as a saved workspace JSON when appropriate.
  const trimmed = raw.trimStart();
  if (trimmed.startsWith("{")) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (isSavedWorkspace(parsed)) {
        return { workspace: normalizeWorkspace(parsed), label };
      }
    } catch {
      // Not JSON — fall through and parse as source code (e.g., CUDA block).
    }
  }

  const language = options.lang ? parseLanguage(options.lang) : inferLanguageFromPath(extPath);
  return { workspace: createWorkspace(raw, { language, granularity }).workspace, label };
}

function findExample(query: string) {
  const lower = query.toLowerCase();
  const exact = EXAMPLES.find((e) => e.name.toLowerCase() === lower);
  if (exact) return exact;
  const partial = EXAMPLES.filter((e) => e.name.toLowerCase().includes(lower));
  if (partial.length === 1) return partial[0] as (typeof EXAMPLES)[number];
  const names = EXAMPLES.map((e) => `"${e.name}"`).join(", ");
  throw new CliError(
    partial.length > 1
      ? `Ambiguous example '${query}'. Matches: ${partial.map((e) => `"${e.name}"`).join(", ")}`
      : `Unknown example '${query}'. Available: ${names}`,
  );
}

function parseBatchOpsJson(raw: string): BatchOp[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new CliError("Operations input is not valid JSON.");
  }
  const list = Array.isArray(parsed)
    ? parsed
    : typeof parsed === "object" && parsed !== null && Array.isArray((parsed as { ops?: unknown }).ops)
      ? (parsed as { ops: unknown[] }).ops
      : null;
  if (!list) {
    throw new CliError('Operations JSON must be an array of ops or an object `{ "ops": [...] }`.');
  }
  for (const [i, item] of list.entries()) {
    if (typeof item !== "object" || item === null || typeof (item as { op?: unknown }).op !== "string") {
      throw new CliError(`Operation #${i} must be an object with a string 'op' field.`);
    }
  }
  return list as BatchOp[];
}
