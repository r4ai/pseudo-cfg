import type { Cfg } from "@/features/cfg/build-cfg";
import { arrowhead, roundedPath } from "./edge-route";
import { nodeBoxes, routeEdges } from "./geometry";
import type { Positions } from "./layout";
import { shapeOf } from "./shapes";

const PADDING = 24;
const PIXEL_RATIO = 2;
const FONT = "ui-monospace, 'SF Mono', SFMono-Regular, Menlo, Consolas, monospace";

/** Exports always use a light palette so images read well in documents and slides. */
const COLORS = {
  background: "#ffffff",
  text: "#171717",
  muted: "#737373",
  stroke: "#7a7a7a",
  edge: "#5c5c5c",
  fill: { start: "#f2f2f2", end: "#f2f2f2", block: "#ffffff", branch: "#fdf6e3", loop: "#eef4fd" },
} as const;

/**
 * Renders the diagram as a standalone SVG document straight from the model,
 * independent of the on-screen DOM, theme, zoom and selection.
 */
export function diagramToSvg(cfg: Cfg, positions: Positions): string {
  const boxes = nodeBoxes(cfg, positions);
  const all = [...boxes.values()];
  const minX = Math.min(...all.map((b) => b.x)) - PADDING;
  const minY = Math.min(...all.map((b) => b.y)) - PADDING;
  const width = Math.max(...all.map((b) => b.x + b.width)) + PADDING - minX;
  const height = Math.max(...all.map((b) => b.y + b.height)) + PADDING - minY;

  const edges = routeEdges(cfg, boxes).map(({ geometry, label }) => {
    const { line, head } = arrowhead(geometry.points);
    const { x, y } = geometry.labelAt;
    const text = label
      ? `<rect x="${x - label.length * 3.5 - 4}" y="${y - 8}" width="${label.length * 7 + 8}" height="16" rx="4" fill="${COLORS.background}"/>` +
        `<text x="${x}" y="${y}" fill="${COLORS.muted}" font-size="11" text-anchor="middle" dominant-baseline="central">${escapeXml(label)}</text>`
      : "";
    return `<path d="${roundedPath(line)}" fill="none" stroke="${COLORS.edge}" stroke-width="1.5"/><polygon points="${head}" fill="${COLORS.edge}"/>${text}`;
  });

  const nodes = cfg.nodes.map((node) => {
    const box = boxes.get(node.id);
    if (!box) return "";
    const shape = shapeOf(node.kind, box.width, box.height);
    const paint = `fill="${COLORS.fill[node.kind]}" stroke="${COLORS.stroke}" stroke-width="1.25"`;
    const outline =
      shape.type === "rect"
        ? `<rect width="${box.width}" height="${box.height}" rx="${shape.rx}" ${paint}/>`
        : `<polygon points="${shape.points}" ${paint}/>`;
    const lines = node.label.split("\n");
    const tspans = lines
      .map(
        (line, i) =>
          `<tspan x="${box.width / 2}" y="${box.height / 2 + (i - (lines.length - 1) / 2) * 20}">${escapeXml(line)}</tspan>`,
      )
      .join("");
    const text = `<text fill="${COLORS.text}" font-size="13" text-anchor="middle" dominant-baseline="central" xml:space="preserve">${tspans}</text>`;
    return `<g transform="translate(${box.x} ${box.y})">${outline}${text}</g>`;
  });

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${minX} ${minY} ${width} ${height}" font-family="${FONT}">`,
    `<rect x="${minX}" y="${minY}" width="${width}" height="${height}" fill="${COLORS.background}"/>`,
    ...edges,
    ...nodes,
    "</svg>",
  ].join("");
}

/** Rasterises an SVG document at twice its size for crisp pasting. */
export async function svgToPng(svg: string): Promise<Blob> {
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth * PIXEL_RATIO;
  canvas.height = image.naturalHeight * PIXEL_RATIO;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is not available");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not encode PNG"))), "image/png"),
  );
}

/** Writes a PNG to the clipboard. The blob is passed as a promise so Safari keeps the user gesture. */
export async function copyPng(png: Promise<Blob>): Promise<void> {
  await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function escapeXml(text: string): string {
  return text.replace(/[<>&"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}
