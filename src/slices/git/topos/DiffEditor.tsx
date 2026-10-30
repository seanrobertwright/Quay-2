import React, { useEffect, useRef } from "react";
import { Compartment, EditorState, type Extension, type Range } from "@codemirror/state";
import { Decoration, EditorView, gutter, GutterMarker, WidgetType } from "@codemirror/view";
import type { DiffDoc, DocLine, Hunk } from "./diffDoc";

/** The hunk header's button: Stage hunk or Unstage hunk. */
export interface HunkAction {
  label: string;
  /** The hunk whose operation is running, which shows busy. */
  busyHunk: number | null;
  /** Whether any staging operation is running, so the buttons wait. */
  disabled: boolean;
  onAct: (hunk: number) => void;
}

export interface DiffEditorProps {
  doc: DiffDoc;
  hunks: Hunk[];
  /** Which line numbers the gutter shows: both for unified, one side for each split pane. */
  numbers: "both" | "old" | "new";
  /** Null shows the hunk headers without a button, as the split view's right pane does. */
  action: HunkAction | null;
  ariaLabel: string;
  /** The other split pane, whose vertical scroll follows this one's. */
  onScroll?: (top: number) => void;
  scrollTop?: number;
}

class NumberMarker extends GutterMarker {
  constructor(readonly text: string) {
    super();
  }
  eq(other: NumberMarker) {
    return other.text === this.text;
  }
  toDOM() {
    return document.createTextNode(this.text);
  }
}

/** A gutter of line numbers from `lines`, one side's or the other's. */
function numberGutter(lines: DocLine[], pick: (l: DocLine) => number | null, className: string): Extension {
  return gutter({
    class: className,
    lineMarker(view, line) {
      const info = lines[view.state.doc.lineAt(line.from).number - 1];
      const n = info ? pick(info) : null;
      return n === null ? null : new NumberMarker(String(n));
    },
    initialSpacer: () => new NumberMarker("99999"),
  });
}

/**
 * The header over each hunk. Its text and button label are set as text, never as markup, since
 * a hunk heading is the file's own content.
 */
class HunkHeader extends WidgetType {
  constructor(
    readonly index: number,
    readonly text: string,
    readonly action: { label: string; busy: boolean; disabled: boolean; onAct: (hunk: number) => void } | null
  ) {
    super();
  }
  eq(other: HunkHeader) {
    return (
      other.index === this.index &&
      other.text === this.text &&
      other.action?.label === this.action?.label &&
      other.action?.busy === this.action?.busy &&
      other.action?.disabled === this.action?.disabled
    );
  }
  toDOM() {
    const row = document.createElement("div");
    row.className = "cm-hunk-header";
    const label = document.createElement("span");
    label.className = "cm-hunk-text";
    label.textContent = this.text;
    row.append(label);
    const action = this.action;
    if (action) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "cm-hunk-action";
      button.textContent = action.busy ? "Working…" : action.label;
      button.disabled = action.disabled;
      button.setAttribute("aria-label", `${action.label} ${this.index + 1}`);
      if (action.busy) button.setAttribute("aria-busy", "true");
      button.addEventListener("click", () => action.onAct(this.index));
      row.append(button);
    }
    return row;
  }
  get estimatedHeight() {
    return 26;
  }
  ignoreEvent() {
    return true;
  }
}

const LINE_CLASS: Record<DocLine["kind"], string | null> = {
  context: null,
  add: "cm-diff-add",
  del: "cm-diff-del",
  noNewline: "cm-diff-note",
  filler: "cm-diff-filler",
};

function decorations(view: { doc: DiffDoc; hunks: Hunk[]; action: HunkAction | null }, state: EditorState): Extension {
  const ranges: Range<Decoration>[] = [];
  view.doc.lines.forEach((l, i) => {
    const cls = LINE_CLASS[l.kind];
    if (cls !== null) ranges.push(Decoration.line({ class: cls }).range(state.doc.line(i + 1).from));
  });
  view.doc.hunkStarts.forEach((start, index) => {
    const h = view.hunks[index];
    if (h === undefined || start >= state.doc.lines) return;
    const text = `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@${h.heading ? ` ${h.heading}` : ""}`;
    const a = view.action;
    const widget = new HunkHeader(
      index,
      text,
      a && { label: a.label, busy: a.busyHunk === index, disabled: a.disabled, onAct: a.onAct }
    );
    ranges.push(Decoration.widget({ widget, block: true, side: -1 }).range(state.doc.line(start + 1).from));
  });
  return EditorView.decorations.of(Decoration.set(ranges, true));
}

const theme = EditorView.theme(
  {
    "&": { height: "100%", fontSize: "12px", backgroundColor: "#0d1117", color: "#c9d1d9" },
    ".cm-scroller": { fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace", lineHeight: "18px" },
    ".cm-content": { caretColor: "#c9d1d9" },
    ".cm-gutters": { backgroundColor: "#0d1117", color: "#6e7681", borderRight: "1px solid #21262d" },
    ".cm-gutterElement": { padding: "0 6px", textAlign: "right" },
    ".cm-diff-add": { backgroundColor: "rgba(46, 160, 67, 0.15)" },
    ".cm-diff-del": { backgroundColor: "rgba(248, 81, 73, 0.15)" },
    ".cm-diff-note": { color: "#8b949e", fontStyle: "italic" },
    ".cm-diff-filler": {
      backgroundImage: "repeating-linear-gradient(135deg, transparent 0 4px, rgba(110, 118, 129, 0.12) 4px 6px)",
    },
    ".cm-hunk-header": {
      display: "flex",
      alignItems: "center",
      gap: "8px",
      height: "26px",
      padding: "0 8px",
      backgroundColor: "rgba(56, 139, 253, 0.1)",
      borderTop: "1px solid #21262d",
      borderBottom: "1px solid #21262d",
      color: "#8b949e",
      fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
      fontSize: "11px",
    },
    ".cm-hunk-text": { flex: "1", minWidth: "0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
    ".cm-hunk-action": {
      flexShrink: "0",
      padding: "1px 8px",
      borderRadius: "4px",
      border: "1px solid #30363d",
      backgroundColor: "#21262d",
      color: "#c9d1d9",
      cursor: "pointer",
      fontFamily: "inherit",
    },
    ".cm-hunk-action:hover:not(:disabled)": { backgroundColor: "#30363d", color: "#ffffff" },
    ".cm-hunk-action:focus-visible": { outline: "1px solid #06B6D4" },
    ".cm-hunk-action:disabled": { opacity: "0.5", cursor: "default" },
    "&.cm-focused": { outline: "none" },
  },
  { dark: true }
);

/**
 * One read-only CodeMirror 6 view of a diff doc: line numbers, add and delete backgrounds, and a
 * header over each hunk with its Stage or Unstage hunk button. The view is rebuilt when the doc
 * changes; a change of busy state only swaps its decorations.
 */
export const DiffEditor: React.FC<DiffEditorProps> = ({ doc, hunks, numbers, action, ariaLabel, onScroll, scrollTop }) => {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const decos = useRef(new Compartment());
  const latest = useRef({ onScroll });
  latest.current = { onScroll };

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const gutters: Extension[] = [];
    if (numbers !== "new") gutters.push(numberGutter(doc.lines, (l) => l.oldNo, "cm-old-numbers"));
    if (numbers !== "old") gutters.push(numberGutter(doc.lines, (l) => l.newNo, "cm-new-numbers"));
    const state = EditorState.create({
      doc: doc.text,
      extensions: [
        // Only `\n` ends a line; a CR is shown, not obeyed.
        EditorState.lineSeparator.of("\n"),
        EditorState.readOnly.of(true),
        EditorView.contentAttributes.of({ "aria-label": ariaLabel, "aria-readonly": "true" }),
        gutters,
        theme,
        // Filled by the effect below, so a busy change reconfigures only the decorations.
        decos.current.of([]),
      ],
    });
    const v = new EditorView({ state, parent: el });
    view.current = v;
    const scrolled = () => latest.current.onScroll?.(v.scrollDOM.scrollTop);
    v.scrollDOM.addEventListener("scroll", scrolled, { passive: true });
    return () => {
      v.scrollDOM.removeEventListener("scroll", scrolled);
      v.destroy();
      view.current = null;
    };
  }, [doc, numbers, ariaLabel]);

  useEffect(() => {
    const v = view.current;
    if (!v) return;
    v.dispatch({ effects: decos.current.reconfigure(decorations({ doc, hunks, action }, v.state)) });
  }, [doc, hunks, action]);

  useEffect(() => {
    const v = view.current;
    if (v && scrollTop !== undefined && Math.abs(v.scrollDOM.scrollTop - scrollTop) > 1) v.scrollDOM.scrollTop = scrollTop;
  }, [scrollTop]);

  return <div ref={host} className="h-full min-h-0 overflow-hidden" />;
};
