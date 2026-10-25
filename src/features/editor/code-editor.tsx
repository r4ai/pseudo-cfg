"use client";

import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { cpp } from "@codemirror/lang-cpp";
import { python } from "@codemirror/lang-python";
import { bracketMatching, foldGutter, foldKeymap, indentOnInput, indentUnit } from "@codemirror/language";
import { type Diagnostic as LintDiagnostic, lintGutter, lintKeymap, setDiagnostics } from "@codemirror/lint";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { Compartment, EditorSelection, EditorState } from "@codemirror/state";
import {
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { indentationMarkers } from "@replit/codemirror-indentation-markers";
import { type Ref, useEffect, useImperativeHandle, useRef } from "react";
import type { Language } from "@/features/cfg/build-cfg";
import type { Diagnostic } from "@/features/cfg/parse";
import { editorTheme } from "./editor-theme";
import { highlightedLines, type LineRange, setHighlightedLines } from "./line-highlight";
import { monacoKeymap, monacoMouse } from "./monaco-keymap";

export type CodeEditorHandle = {
  /** Highlights and scrolls to a range of lines, or clears the highlight. */
  reveal: (range: LineRange | null) => void;
  focusLine: (line: number) => void;
  /** Replaces the whole text as one undoable edit. */
  setValue: (value: string) => void;
};

type CodeEditorProps = {
  defaultValue: string;
  language: Language;
  diagnostics: Diagnostic[];
  onChange: (value: string) => void;
  onCursorLineChange: (line: number) => void;
  ref?: Ref<CodeEditorHandle>;
};

const LANGUAGE_SUPPORT = { python, cuda: cpp } satisfies Record<Language, unknown>;
/** Holds the syntax mode so it can change without recreating the editor. */
const languageSupport = new Compartment();

export function CodeEditor({
  defaultValue,
  language,
  diagnostics,
  onChange,
  onCursorLineChange,
  ref,
}: CodeEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const callbacks = useRef({ onChange, onCursorLineChange });
  useEffect(() => {
    callbacks.current = { onChange, onCursorLineChange };
  });

  // `defaultValue` only seeds the document; the editor owns it afterwards.
  const initialDoc = useRef(defaultValue);
  const initialLanguage = useRef(language);

  // The editor is an external, imperatively managed widget; create it once.
  useEffect(() => {
    const view = new EditorView({
      parent: containerRef.current as HTMLDivElement,
      state: EditorState.create({
        doc: initialDoc.current,
        extensions: [
          extensions(),
          languageSupport.of(LANGUAGE_SUPPORT[initialLanguage.current]()),
          listeners(callbacks),
        ],
      }),
    });
    viewRef.current = view;
    return () => view.destroy();
  }, []);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: languageSupport.reconfigure(LANGUAGE_SUPPORT[language]()),
    });
  }, [language]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch(
      setDiagnostics(
        view.state,
        diagnostics.map((d) => toLintDiagnostic(view.state, d)),
      ),
    );
  }, [diagnostics]);

  useImperativeHandle(ref, () => ({
    reveal(range) {
      const view = viewRef.current;
      if (!view) return;
      const line = range ? view.state.doc.line(Math.min(range.line, view.state.doc.lines)) : null;
      view.dispatch({
        effects: [
          setHighlightedLines.of(range),
          ...(line ? [EditorView.scrollIntoView(line.from, { y: "nearest" })] : []),
        ],
      });
    },
    focusLine(lineNumber) {
      const view = viewRef.current;
      if (!view) return;
      const line = view.state.doc.line(Math.min(lineNumber, view.state.doc.lines));
      const indent = /^\s*/.exec(line.text)?.[0].length ?? 0;
      view.dispatch({ selection: EditorSelection.cursor(line.from + indent), scrollIntoView: true });
      view.focus();
    },
    setValue(value) {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
        selection: EditorSelection.cursor(0),
        scrollIntoView: true,
      });
      view.focus();
    },
  }));

  return <div ref={containerRef} className="min-h-0 flex-1 overflow-hidden" />;
}

function extensions() {
  return [
    lineNumbers(),
    foldGutter(),
    lintGutter(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    history(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    EditorState.tabSize.of(4),
    indentUnit.of("    "),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    autocompletion(),
    highlightActiveLine(),
    highlightSelectionMatches({ highlightWordAroundCursor: true }),
    indentationMarkers({ markerType: "codeOnly" }),
    search({ top: true }),
    highlightedLines,
    editorTheme,
    monacoMouse,
    keymap.of([
      ...monacoKeymap,
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...searchKeymap,
      ...historyKeymap,
      ...foldKeymap,
      ...completionKeymap,
      ...lintKeymap,
    ]),
  ];
}

function listeners(callbacks: { current: Pick<CodeEditorProps, "onChange" | "onCursorLineChange"> }) {
  return EditorView.updateListener.of((update) => {
    if (update.docChanged) callbacks.current.onChange(update.state.doc.toString());
    if (update.docChanged || update.selectionSet) {
      callbacks.current.onCursorLineChange(update.state.doc.lineAt(update.state.selection.main.head).number);
    }
  });
}

function toLintDiagnostic(state: EditorState, diagnostic: Diagnostic): LintDiagnostic {
  const line = state.doc.line(Math.min(diagnostic.line, state.doc.lines));
  return { from: line.from, to: line.to, severity: diagnostic.severity, message: diagnostic.message };
}
