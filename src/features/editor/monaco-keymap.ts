import { acceptCompletion, startCompletion } from "@codemirror/autocomplete";
import {
  copyLineDown,
  copyLineUp,
  cursorMatchingBracket,
  deleteLine,
  indentLess,
  indentMore,
  insertBlankLine,
  lineComment,
  lineUncomment,
  moveLineDown,
  moveLineUp,
  redoSelection,
  selectLine,
  selectParentSyntax,
  toggleComment,
  undoSelection,
} from "@codemirror/commands";
import { foldAll, foldCode, getIndentUnit, unfoldAll, unfoldCode } from "@codemirror/language";
import { gotoLine, openSearchPanel, selectNextOccurrence, selectSelectionMatches } from "@codemirror/search";
import { EditorSelection, type Extension } from "@codemirror/state";
import { type Command, EditorView, type KeyBinding, rectangularSelection } from "@codemirror/view";

/** Adds a cursor one line above or below every existing cursor (Cmd/Ctrl+Alt+Up/Down). */
const addCursorVertically =
  (forward: boolean): Command =>
  (view) => {
    const { ranges } = view.state.selection;
    const added = ranges.map((range) => view.moveVertically(EditorSelection.cursor(range.head), forward));
    view.dispatch({
      selection: EditorSelection.create(
        [...ranges, ...added],
        ranges.length + view.state.selection.mainIndex,
      ),
      scrollIntoView: true,
    });
    return true;
  };

/** Opens an indented line above the cursor (Cmd/Ctrl+Shift+Enter). */
const insertLineAbove: Command = ({ state, dispatch }) => {
  if (state.readOnly) return false;
  const update = state.changeByRange((range) => {
    const line = state.doc.lineAt(range.head);
    const indent = /^\s*/.exec(line.text)?.[0] ?? "";
    return {
      changes: { from: line.from, insert: indent + state.lineBreak },
      range: EditorSelection.cursor(line.from + indent.length),
    };
  });
  dispatch(state.update(update, { scrollIntoView: true, userEvent: "input" }));
  return true;
};

/** Puts a cursor at the end of every selected line (Shift+Alt+I). */
const cursorsAtLineEnds: Command = ({ state, dispatch }) => {
  const cursors = state.selection.ranges.flatMap((range) => {
    const first = state.doc.lineAt(range.from).number;
    const last = state.doc.lineAt(range.to).number;
    return Array.from({ length: last - first + 1 }, (_, k) =>
      EditorSelection.cursor(state.doc.line(first + k).to),
    );
  });
  dispatch(state.update({ selection: EditorSelection.create(cursors), scrollIntoView: true }));
  return true;
};

/** Tab inserts spaces up to the next tab stop, or indents when text is selected. */
const tab: Command = (view) => {
  const { state } = view;
  if (state.selection.ranges.some((range) => !range.empty)) return indentMore(view);
  const unit = getIndentUnit(state);
  view.dispatch(
    state.update(
      state.changeByRange((range) => {
        const column = range.head - state.doc.lineAt(range.head).from;
        const insert = " ".repeat(unit - (column % unit));
        return {
          changes: { from: range.head, insert },
          range: EditorSelection.cursor(range.head + insert.length),
        };
      }),
      { scrollIntoView: true, userEvent: "input" },
    ),
  );
  return true;
};

/**
 * Bindings that follow VS Code / Monaco defaults. They take precedence over
 * CodeMirror's default keymap where the two disagree.
 */
export const monacoKeymap: readonly KeyBinding[] = [
  { key: "Mod-d", run: selectNextOccurrence, preventDefault: true },
  { key: "Mod-Shift-l", run: selectSelectionMatches, preventDefault: true },
  { key: "Mod-F2", run: selectSelectionMatches, preventDefault: true },
  { key: "Mod-Alt-ArrowUp", run: addCursorVertically(false), preventDefault: true },
  { key: "Mod-Alt-ArrowDown", run: addCursorVertically(true), preventDefault: true },
  { key: "Shift-Alt-i", run: cursorsAtLineEnds, preventDefault: true },
  { key: "Alt-ArrowUp", run: moveLineUp, preventDefault: true },
  { key: "Alt-ArrowDown", run: moveLineDown, preventDefault: true },
  { key: "Shift-Alt-ArrowUp", run: copyLineUp, preventDefault: true },
  { key: "Shift-Alt-ArrowDown", run: copyLineDown, preventDefault: true },
  { key: "Mod-Shift-k", run: deleteLine, preventDefault: true },
  { key: "Mod-Enter", run: insertBlankLine, preventDefault: true },
  { key: "Mod-Shift-Enter", run: insertLineAbove, preventDefault: true },
  { key: "Mod-]", run: indentMore, preventDefault: true },
  { key: "Mod-[", run: indentLess, preventDefault: true },
  { key: "Tab", run: acceptCompletion },
  { key: "Tab", run: tab, shift: indentLess, preventDefault: true },
  { key: "Mod-/", run: toggleComment, preventDefault: true },
  { key: "Mod-k Mod-c", run: lineComment, preventDefault: true },
  { key: "Mod-k Mod-u", run: lineUncomment, preventDefault: true },
  { key: "Mod-l", run: selectLine, preventDefault: true },
  {
    mac: "Ctrl-Shift-Mod-ArrowRight",
    key: "Shift-Alt-ArrowRight",
    run: selectParentSyntax,
    preventDefault: true,
  },
  { key: "Mod-u", run: undoSelection, preventDefault: true },
  { key: "Mod-Shift-u", run: redoSelection, preventDefault: true },
  { key: "Mod-Shift-\\", run: cursorMatchingBracket, preventDefault: true },
  { key: "Mod-Alt-[", run: foldCode, preventDefault: true },
  { key: "Mod-Alt-]", run: unfoldCode, preventDefault: true },
  { key: "Mod-k Mod-0", run: foldAll, preventDefault: true },
  { key: "Mod-k Mod-j", run: unfoldAll, preventDefault: true },
  { mac: "Mod-Alt-f", key: "Mod-h", run: openSearchPanel, preventDefault: true },
  { key: "Ctrl-g", run: gotoLine, preventDefault: true },
  { mac: "Mod-i", key: "Ctrl-i", run: startCompletion, preventDefault: true },
];

/** Monaco-style mouse gestures: Alt+Click adds a cursor, Shift+Alt+Drag selects a column. */
export const monacoMouse: Extension = [
  EditorView.clickAddsSelectionRange.of((event) => event.altKey),
  rectangularSelection({ eventFilter: (event) => event.altKey && event.shiftKey }),
];
