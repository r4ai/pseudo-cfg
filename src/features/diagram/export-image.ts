import type { Cfg } from "@/features/cfg/build-cfg";
import { arrowhead, roundedPath, toneOf } from "./edge-route";
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
  stroke: "#7a7a7a",
  edge: "#5c5c5c",
  label: {
    yes: { text: "#1d7a46", fill: "#ecf7f0", stroke: "#a8d9bb" },
    no: { text: "#b4441f", fill: "#fdf0eb", stroke: "#f0b9a5" },
    plain: { text: "#737373", fill: "#ffffff", stroke: "#e5e5e5" },
  },
  fill: { start: "#f2f2f2", end: "#f2f2f2", block: "#ffffff", branch: "#fdf6e3", loop: "#eef4fd" },
} as const;

/**
 * Renders the diagram as a standalone SVG document straight from the model,
 * independent of the on-screen DOM, theme, zoom and selection.
 */
export function diagramToSvg(cfg: Cfg, positions: Positions): string {
  const boxes = nodeBoxes(cfg, positions);
  const routed = routeEdges(cfg, boxes);
  // Back edges run outside the nodes, so the bounds include every edge point and label.
  const all = [
    ...boxes.values(),
    ...routed.flatMap(({ geometry }) => [
      ...geometry.points.map((p) => ({ ...p, width: 0, height: 0 })),
      { x: geometry.labelAt.x - 24, y: geometry.labelAt.y - 8, width: 48, height: 16 },
    ]),
  ];
  const minX = Math.min(...all.map((b) => b.x)) - PADDING;
  const minY = Math.min(...all.map((b) => b.y)) - PADDING;
  const width = Math.max(...all.map((b) => b.x + b.width)) + PADDING - minX;
  const height = Math.max(...all.map((b) => b.y + b.height)) + PADDING - minY;

  const edges = routed.map(({ geometry, back }) => {
    const { line, head } = arrowhead(geometry.points);
    const dash = back ? ` stroke-dasharray="5 4"` : "";
    return `<path d="${roundedPath(line)}" fill="none" stroke="${COLORS.edge}" stroke-width="1.5"${dash}/><polygon points="${head}" fill="${COLORS.edge}"/>`;
  });
  // Labels go on top of every edge, as they do on screen.
  const labels = routed.flatMap(({ geometry, label }) => {
    if (!label) return [];
    const { x, y } = geometry.labelAt;
    const color = COLORS.label[toneOf(label)];
    const pill = label.length * 6.5 + 12;
    return [
      `<rect x="${x - pill / 2}" y="${y - 8}" width="${pill}" height="16" rx="8" fill="${color.fill}" stroke="${color.stroke}"/>` +
        `<text x="${x}" y="${y}" fill="${color.text}" font-size="11" font-weight="500" text-anchor="middle" dominant-baseline="central">${escapeXml(label)}</text>`,
    ];
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
    ...labels,
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
