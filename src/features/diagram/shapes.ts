import type { CfgNodeKind } from "@/features/cfg/build-cfg";

export type Shape = { type: "rect"; rx: number } | { type: "polygon"; points: string };

/** Outline of a node in its own coordinate space (0,0 is the top-left corner). */
export function shapeOf(kind: CfgNodeKind, width: number, height: number): Shape {
  switch (kind) {
    case "start":
    case "end":
      return { type: "rect", rx: height / 2 };
    case "block":
      return { type: "rect", rx: 6 };
    case "branch":
      return {
        type: "polygon",
        points: `${width / 2},0 ${width},${height / 2} ${width / 2},${height} 0,${height / 2}`,
      };
    case "loop": {
      const inset = height / 2;
      return {
        type: "polygon",
        points: `${inset},0 ${width - inset},0 ${width},${height / 2} ${width - inset},${height} ${inset},${height} 0,${height / 2}`,
      };
    }
  }
}
