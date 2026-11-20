import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCli } from "./run";

const execFileAsync = promisify(execFile);

function createRunner(cwd: string, stdinText = "") {
  return async (argv: string[], stdin = stdinText) => {
    let stdout = "";
    let stderr = "";
    const code = await runCli(argv, {
      cwd,
      stdinIsTTY: stdin.length === 0,
      readStdin: async () => stdin,
      writeStdout: (chunk) => {
        stdout += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      },
      writeStderr: (chunk) => {
        stderr += chunk;
      },
    });
    return { code, stdout, stderr };
  };
}

describe("pseudo-cfg CLI", () => {
  let dir = "";

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "pseudo-cfg-cli-test-"));
  });

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("runs the full agent workflow: init -> inspect -> node move -> edge route/shift -> check -> render", async () => {
    const run = createRunner(dir);
    const pyPath = join(dir, "algo.py");
    await writeFile(
      pyPath,
      `def search(items, target):
    i = 0
    while i < len(items):
        if items[i] == target:
            return i
        i = i + 1
    return -1
`,
      "utf8",
    );

    // 1. init
    const initRes = await run(["init", "algo.py", "-o", "algo.json", "--json"]);
    expect(initRes.code).toBe(0);
    const initJson = JSON.parse(initRes.stdout);
    expect(initJson.ok).toBe(true);
    expect(initJson.language).toBe("python");
    expect(initJson.nodes).toBeGreaterThan(4);

    // 2. inspect (text + json)
    const inspectText = await run(["inspect", "algo.json"]);
    expect(inspectText.code).toBe(0);
    expect(inspectText.stdout).toContain("Nodes:");
    expect(inspectText.stdout).toContain("Edges:");

    const inspectJsonRes = await run(["inspect", "algo.json", "--json"]);
    expect(inspectJsonRes.code).toBe(0);
    const inspected = JSON.parse(inspectJsonRes.stdout);
    expect(inspected.quality.ok).toBe(true);

    // 3. node move with negative deltas
    const moveRes = await run(["node", "move", "algo.json", "n1", "--dx", "-16", "--dy", "8", "--json"]);
    expect(moveRes.code).toBe(0);
    const moved = JSON.parse(moveRes.stdout);
    expect(moved.ok).toBe(true);

    // 4. edge list & edge inspect
    const edgeList = await run(["edge", "list", "algo.json"]);
    expect(edgeList.code).toBe(0);
    expect(edgeList.stdout).toContain("e0");

    const backEdge = inspected.edges.find((e: { back: boolean }) => e.back);
    expect(backEdge).toBeDefined();

    // 5. edge shift with negative positional delta
    const vertSeg = backEdge.segments.find((s: { orientation: string }) => s.orientation === "vertical");
    expect(vertSeg).toBeDefined();
    const shiftRes = await run([
      "edge",
      "shift",
      "algo.json",
      backEdge.handle,
      String(vertSeg.index),
      "-24",
      "--json",
    ]);
    expect(shiftRes.code).toBe(0);
    const shifted = JSON.parse(shiftRes.stdout);
    expect(shifted.edge.mode).toBe("points");

    // 6. edge route (pin sides) & edge reset
    const routeRes = await run([
      "edge",
      "route",
      "algo.json",
      backEdge.handle,
      "--from",
      "left",
      "--to",
      "left",
      "--json",
    ]);
    expect(routeRes.code).toBe(0);
    const routed = JSON.parse(routeRes.stdout);
    expect(routed.edge.sourceSide).toBe("left");
    expect(routed.edge.targetSide).toBe("left");

    const resetRes = await run(["edge", "reset", "algo.json", backEdge.handle, "--json"]);
    expect(resetRes.code).toBe(0);
    expect(JSON.parse(resetRes.stdout).resetCount).toBe(1);

    // 7. check
    const checkRes = await run(["check", "algo.json", "--json"]);
    expect(checkRes.code).toBe(0);
    expect(JSON.parse(checkRes.stdout).ok).toBe(true);

    // 8. render to SVG file
    const renderRes = await run(["render", "algo.json", "-o", "algo.svg", "--json"]);
    expect(renderRes.code).toBe(0);
    const svg = await readFile(join(dir, "algo.svg"), "utf8");
    expect(svg.startsWith("<svg ")).toBe(true);
    expect(svg).toContain("search");
  });

  it("supports one-shot render from raw source, stdin, --code, and CUDA auto-detection", async () => {
    const run = createRunner(dir);

    const cuPath = join(dir, "kernel.cu");
    await writeFile(cuPath, "__global__ void f(int n) { if (n > 0) { x(); } }", "utf8");
    const cuSvg = await run(["render", "kernel.cu"]);
    expect(cuSvg.code).toBe(0);
    expect(cuSvg.stdout).toContain("<svg ");
    expect(cuSvg.stdout).toContain("__global__ void f(int n)");

    const stdinSvg = await run(["render"], "if ok:\n    go()\n");
    expect(stdinSvg.code).toBe(0);
    expect(stdinSvg.stdout).toContain("if ok");

    const inlineSvg = await run(["render", "--code", "a = 1\nb = 2"]);
    expect(inlineSvg.code).toBe(0);
    expect(inlineSvg.stdout).toContain("a = 1");
  });

  it("supports incremental source update, set granularity, tidy, and batch apply with --render", async () => {
    const run = createRunner(dir);

    await run(["init", "--code", "if a:\n    x()\nelse:\n    y()\nz()", "-o", "g.json"]);
    await run(["node", "move", "g.json", "n4", "--x", "400", "--y", "180"]);
    await run(["edge", "route", "g.json", "n2->n4:F", "--from", "right", "--to", "left"]);

    // Source update keeps manual position of n4
    const srcRes = await run([
      "source",
      "g.json",
      "--code",
      "if a:\n    x()\n    w()\nelse:\n    y()\nz()",
      "--json",
    ]);
    expect(srcRes.code).toBe(0);
    expect(JSON.parse(srcRes.stdout).relaid).toBe(false);
    const afterSrc = JSON.parse(await readFile(join(dir, "g.json"), "utf8"));
    expect(afterSrc.positions.n4).toEqual({ x: 400, y: 180 });
    expect(afterSrc.edges["n2>n4:False"]).toEqual({ source: "right", target: "left" });

    // Batch apply with dry-run first, then real apply + render
    const ops = JSON.stringify({
      ops: [
        { op: "node.move", id: "n4", dx: 20, dy: -10 },
        { op: "edge.reset", all: true },
      ],
    });
    const dry = await run(["apply", "g.json", "--ops", ops, "--dry-run", "--json"]);
    expect(dry.code).toBe(0);
    expect(JSON.parse(dry.stdout).dryRun).toBe(true);
    expect(JSON.parse(await readFile(join(dir, "g.json"), "utf8")).positions.n4.x).toBe(400);

    const real = await run(["apply", "g.json", "--ops", ops, "--render", "out.svg", "--json"]);
    expect(real.code).toBe(0);
    expect(JSON.parse(await readFile(join(dir, "g.json"), "utf8")).positions.n4).toEqual({ x: 420, y: 170 });
    expect((await readFile(join(dir, "out.svg"), "utf8")).startsWith("<svg ")).toBe(true);

    // Switch granularity and tidy
    const setRes = await run(["set", "g.json", "--granularity", "statement", "--json"]);
    expect(setRes.code).toBe(0);
    expect(JSON.parse(setRes.stdout).granularity).toBe("statement");

    const tidyRes = await run(["tidy", "g.json", "--json"]);
    expect(tidyRes.code).toBe(0);
  });

  it("exits with code 2 from check when layout overlaps or diagnostics fail", async () => {
    const run = createRunner(dir);

    // Unreachable code: warning only -> passes without --strict, fails with --strict
    const warnPass = await run(["check", "--code", "return 1\nx = 2", "--json"]);
    expect(warnPass.code).toBe(0);
    const warnStrict = await run(["check", "--code", "return 1\nx = 2", "--strict", "--json"]);
    expect(warnStrict.code).toBe(2);

    // Syntax error -> fails even without --strict
    const errCheck = await run(["check", "--code", "break", "--json"]);
    expect(errCheck.code).toBe(2);

    // Manual node overlap -> fails check
    await run(["init", "--code", "a()\nb()", "--granularity", "statement", "-o", "ov.json"]);
    const info = JSON.parse((await run(["inspect", "ov.json", "--json"])).stdout);
    const n0 = info.nodes[0];
    await run(["node", "move", "ov.json", info.nodes[1].id, "--x", String(n0.x), "--y", String(n0.y)]);
    const overlapCheck = await run(["check", "ov.json", "--json"]);
    expect(overlapCheck.code).toBe(2);
    expect(JSON.parse(overlapCheck.stdout).quality.nodeOverlaps.length).toBeGreaterThan(0);
  });

  it("encodes and decodes share URLs and lists examples", async () => {
    const run = createRunner(dir);

    const exList = await run(["examples", "--lang", "cuda", "--json"]);
    expect(exList.code).toBe(0);
    expect(JSON.parse(exList.stdout).examples.length).toBeGreaterThan(0);

    const shareRes = await run(["share", "--code", "if x:\n    y()", "--json"]);
    expect(shareRes.code).toBe(0);
    const { url } = JSON.parse(shareRes.stdout);
    expect(url).toContain("https://pseudo-cfg.r4ai.dev/#code=");

    const decodeRes = await run(["share", "--decode", url, "--json"]);
    expect(decodeRes.code).toBe(0);
    expect(JSON.parse(decodeRes.stdout)).toEqual({
      ok: true,
      format: "code",
      source: "if x:\n    y()",
      language: "python",
    });

    // Initialize workspace directly from share URL
    const fromUrl = await run(["init", "--from-url", url, "-o", "shared.json", "--json"]);
    expect(fromUrl.code).toBe(0);
    expect(JSON.parse(fromUrl.stdout).ok).toBe(true);
  });

  it("shares and opens declarative YAML specs via #spec= URLs preserving layout", async () => {
    const run = createRunner(dir);
    await writeFile(
      join(dir, "draft.yaml"),
      `language: python
source: |
  if ok:
      go()
  else:
      stop()
layout:
  nodes:
    "stop()":
      leftOf: "if ok"
      gap: 48
  edges:
    "if ok -> stop() [F]":
      from: left
      to: top
`,
      "utf8",
    );

    const openRes = await run(["open", "draft.yaml", "--url-only", "--json"]);
    expect(openRes.code).toBe(0);
    const opened = JSON.parse(openRes.stdout);
    expect(opened.ok).toBe(true);
    expect(opened.includesLayout).toBe(true);
    expect(opened.opened).toBe(false);
    expect(opened.url).toContain("https://pseudo-cfg.r4ai.dev/#spec=");

    const decoded = await run(["share", "--decode", opened.url, "--json"]);
    expect(decoded.code).toBe(0);
    expect(JSON.parse(decoded.stdout).format).toBe("spec");

    // init --from-url with #spec= preserves the layout & edge override
    const fromSpecUrl = await run(["init", "--from-url", opened.url, "-o", "from-url.json", "--json"]);
    expect(fromSpecUrl.code).toBe(0);
    const ws = JSON.parse(await readFile(join(dir, "from-url.json"), "utf8"));
    expect(Object.values(ws.edges)).toContainEqual({ source: "left", target: "top" });
  });

  it("compiles, inspects, checks, renders, and exports declarative YAML specs", async () => {
    const run = createRunner(dir);
    const yamlPath = join(dir, "diagram.yaml");
    await writeFile(
      yamlPath,
      `language: python
granularity: block
source: |
  def classify(x):
      if x > 0:
          y = 1
      else:
          y = -1
      return y

layout:
  nodes:
    "y = -1":
      leftOf: "if x > 0"
      gap: 48
  edges:
    "if x > 0 -> y = -1 [F]":
      from: left
      to: top
`,
      "utf8",
    );

    const checkRes = await run(["check", "diagram.yaml", "--json"]);
    expect(checkRes.code).toBe(0);
    expect(JSON.parse(checkRes.stdout).ok).toBe(true);

    const edgeInspect = await run(["edge", "inspect", "diagram.yaml", "if x > 0 -> y = -1 [F]", "--json"]);
    expect(edgeInspect.code).toBe(0);
    expect(JSON.parse(edgeInspect.stdout).edge.sourceSide).toBe("left");

    const renderRes = await run(["render", "diagram.yaml", "-o", "from-yaml.svg", "--json"]);
    expect(renderRes.code).toBe(0);
    expect((await readFile(join(dir, "from-yaml.svg"), "utf8")).startsWith("<svg ")).toBe(true);

    // Compile YAML -> workspace JSON -> export-yaml roundtrip
    const initRes = await run(["init", "diagram.yaml", "-o", "compiled.json", "--json"]);
    expect(initRes.code).toBe(0);
    const expRes = await run(["export-yaml", "compiled.json", "-o", "exported.yaml", "--json"]);
    expect(expRes.code).toBe(0);
    const exportedText = await readFile(join(dir, "exported.yaml"), "utf8");
    expect(exportedText).toContain("from: left");
  });

  it("executes the built dist/cli.js binary end-to-end", async () => {
    const cliPath = resolve("dist/cli.js");
    try {
      await access(cliPath);
    } catch {
      await execFileAsync(process.execPath, [resolve("scripts/build-cli.ts")]);
    }
    const { stdout } = await execFileAsync(process.execPath, [
      cliPath,
      "inspect",
      "--example",
      "Binary search",
      "--json",
    ]);
    const data = JSON.parse(stdout);
    expect(data.ok).toBe(true);
    expect(data.language).toBe("python");
    expect(data.quality.ok).toBe(true);
  });
});
