import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";

/**
 * VS Code–like look built on the app's CSS variables, so light and dark mode
 * follow the page theme without reconfiguring the editor.
 */
const chrome = EditorView.theme({
  "&": { height: "100%", fontSize: "13px", backgroundColor: "var(--background)", color: "var(--foreground)" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "20px" },
  ".cm-content": { caretColor: "var(--foreground)", paddingBlock: "8px" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--foreground)", borderLeftWidth: "2px" },
  ".cm-gutters": { backgroundColor: "var(--background)", color: "var(--muted-foreground)", border: "none" },
  ".cm-lineNumbers .cm-gutterElement": { paddingInline: "12px 8px", minWidth: "40px" },
  ".cm-activeLine": { backgroundColor: "var(--editor-active-line)" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--foreground)" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground": {
    backgroundColor: "var(--editor-selection)",
  },
  ".cm-selectionMatch": { backgroundColor: "var(--editor-match)" },
  ".cm-matchingBracket": { backgroundColor: "var(--editor-match)", outline: "1px solid var(--border)" },
  ".cm-highlightedLines": { backgroundColor: "var(--editor-highlight)" },
  ".cm-foldGutter .cm-gutterElement": { paddingInline: "4px", cursor: "pointer" },
  ".cm-panels": { backgroundColor: "var(--popover)", color: "var(--popover-foreground)" },
  ".cm-panels-top": { borderBottom: "1px solid var(--border)" },
  ".cm-tooltip": {
    backgroundColor: "var(--popover)",
    color: "var(--popover-foreground)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-md)",
  },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "var(--accent)",
    color: "var(--accent-foreground)",
  },
});

const highlight = HighlightStyle.define([
  {
    tag: [tags.keyword, tags.controlKeyword, tags.operatorKeyword, tags.definitionKeyword],
    color: "var(--syntax-keyword)",
  },
  { tag: [tags.string, tags.special(tags.string)], color: "var(--syntax-string)" },
  { tag: [tags.number, tags.bool, tags.null], color: "var(--syntax-number)" },
  { tag: tags.comment, color: "var(--syntax-comment)", fontStyle: "italic" },
  {
    tag: [tags.function(tags.variableName), tags.function(tags.propertyName)],
    color: "var(--syntax-function)",
  },
  { tag: [tags.definition(tags.variableName), tags.variableName], color: "var(--syntax-variable)" },
  { tag: [tags.className, tags.typeName], color: "var(--syntax-type)" },
]);

export const editorTheme: Extension = [chrome, syntaxHighlighting(highlight)];
