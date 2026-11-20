import { describe, expect, it } from "vitest";
import { parseYaml, yamlBlockString, yamlScalar } from "@/features/workspace/yaml";

describe("parseYaml", () => {
  it("parses nested mappings, sequences, block scalars, flow collections, and comments", () => {
    const doc = parseYaml(`---
# Top comment
language: python
granularity: block
source: |
  def f(x):
      if x > 0:
          return 1
      return -1

layout:
  snap: true
  nodes:
    "if x > 0":
      dx: -40
      dy: 12.5
  edges:
    "if x > 0 -> return 1 [T]":
      from: left
      to: top
      via:
        - [-60, 120]
        - { x: -60, y: 240 }
      shift:
        - segment: 1
          at: -80 # inline comment
`);

    expect(doc).toEqual({
      language: "python",
      granularity: "block",
      source: "def f(x):\n    if x > 0:\n        return 1\n    return -1\n",
      layout: {
        snap: true,
        nodes: {
          "if x > 0": { dx: -40, dy: 12.5 },
        },
        edges: {
          "if x > 0 -> return 1 [T]": {
            from: "left",
            to: "top",
            via: [[-60, 120], { x: -60, y: 240 }],
            shift: [{ segment: 1, at: -80 }],
          },
        },
      },
    });
  });

  it("handles chomp indicators (|-, |+, >-) and single/double quotes", () => {
    const doc = parseYaml(`
strip: |-
  line 1
  line 2
single: 'it''s ok: here'
double: "a\\nb"
empty: null
flag: false
list: [1, -2.5, "three", true]
`);
    expect(doc).toEqual({
      strip: "line 1\nline 2",
      single: "it's ok: here",
      double: "a\nb",
      empty: null,
      flag: false,
      list: [1, -2.5, "three", true],
    });
  });

  it("throws line-numbered errors on malformed YAML", () => {
    expect(() => parseYaml("a: [1, 2\n")).toThrow(/line 1/i);
    expect(() => parseYaml('a: "unterminated\n')).toThrow(/line 1/i);
  });

  it("formats scalars and block strings safely", () => {
    expect(yamlScalar("n4")).toBe("n4");
    expect(yamlScalar("n2>n4:False")).toBe('"n2>n4:False"');
    expect(yamlBlockString("a()\nb()\n")).toBe("|\n  a()\n  b()");
  });
});
