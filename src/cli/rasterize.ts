import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { CliError } from "./args";

const execFileAsync = promisify(execFile);

type Rasterizer = {
  command: string;
  args: (svgPath: string, pngPath: string, scale: number) => string[];
};

const RASTERIZERS: Rasterizer[] = [
  { command: "resvg", args: (svg, png, scale) => ["--zoom", String(scale), svg, png] },
  { command: "rsvg-convert", args: (svg, png, scale) => ["-z", String(scale), "-o", png, svg] },
  {
    command: "inkscape",
    args: (svg, png, scale) => [
      svg,
      "--export-type=png",
      `--export-dpi=${Math.round(96 * scale)}`,
      `-o`,
      png,
    ],
  },
  {
    command: "magick",
    args: (svg, png, scale) => ["-density", String(Math.round(96 * scale)), svg, png],
  },
];

async function tryRasterizers(
  index: number,
  svgPath: string,
  pngPath: string,
  scale: number,
  errors: string[],
): Promise<Buffer> {
  const tool = RASTERIZERS[index];
  if (!tool) {
    const detail = errors.length > 0 ? ` Tried installed tool(s) which failed: ${errors.join("; ")}.` : "";
    throw new CliError(
      `PNG export requires an SVG rasterizer (resvg, rsvg-convert, inkscape, or magick), none of which succeeded.${detail} Render SVG instead (default), or install 'resvg' / 'librsvg'.`,
    );
  }
  try {
    await execFileAsync(tool.command, tool.args(svgPath, pngPath, scale));
    return await readFile(pngPath);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code !== "ENOENT") errors.push(`${tool.command}: ${err.message}`);
    return tryRasterizers(index + 1, svgPath, pngPath, scale, errors);
  }
}

/**
 * Rasterizes an SVG string to PNG bytes using an installed CLI tool
 * (`resvg`, `rsvg-convert`, `inkscape`, or ImageMagick `magick`).
 */
export async function rasterizeSvgToPng(svg: string, scale = 2): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), "pseudo-cfg-"));
  const svgPath = join(dir, "diagram.svg");
  const pngPath = join(dir, "diagram.png");
  try {
    await writeFile(svgPath, svg, "utf8");
    return await tryRasterizers(0, svgPath, pngPath, scale, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
