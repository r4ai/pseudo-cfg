import type { CfgNodeKind } from "@/features/cfg/build-cfg";

export type Shape = { type: "rect"; rx: number } | { type: "polygon"; points: string };

/**
 * Outline of a node in its own coordinate space (0,0 is the top-left corner).
 *
 * @param multiline - The label spans several lines; branches are then hexagons, as in `nodeSize`.
 */
export function shapeOf(kind: CfgNodeKind, width: number, height: number, multiline = false): Shape {
  switch (kind) {
    case "start":
    case "end":
      return { type: "rect", rx: height / 2 };
    case "block":
      return { type: "rect", rx: 6 };
    case "branch":
      if (multiline) return hexagon(width, height);
      return {
        type: "polygon",
        points: `${width / 2},0 ${width},${height / 2} ${width / 2},${height} 0,${height / 2}`,
      };
    case "loop":
      return hexagon(width, height);
  }
}

function hexagon(width: number, height: number): Shape {
  const inset = height / 2;
  return {
    type: "polygon",
    points: `${inset},0 ${width - inset},0 ${width},${height / 2} ${width - inset},${height} ${inset},${height} 0,${height / 2}`,
  };
}
