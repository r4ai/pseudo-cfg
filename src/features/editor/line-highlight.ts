import { type Range, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";

export type LineRange = { line: number; endLine: number };

/** Highlights the source lines of the node selected in the diagram. */
export const setHighlightedLines = StateEffect.define<LineRange | null>();

const lineDecoration = Decoration.line({ class: "cm-highlightedLines" });

export const highlightedLines = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, tr) {
    let next = decorations.map(tr.changes);
    for (const effect of tr.effects) {
      if (!effect.is(setHighlightedLines)) continue;
      next = effect.value ? decorate(tr.state.doc, effect.value) : Decoration.none;
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

function decorate(doc: EditorView["state"]["doc"], { line, endLine }: LineRange): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  for (let n = Math.max(1, line); n <= Math.min(endLine, doc.lines); n++) {
    ranges.push(lineDecoration.range(doc.line(n).from));
  }
  return Decoration.set(ranges);
}
