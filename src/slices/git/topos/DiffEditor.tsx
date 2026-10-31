import React, { useEffect, useRef } from "react";
import { Compartment, EditorState, Prec, type Extension, type Range, type StateEffect } from "@codemirror/state";
import { Decoration, EditorView, gutter, GutterMarker, WidgetType } from "@codemirror/view";
import type { DiffDoc, DocLine, Hunk } from "./diffDoc";
import { changedAt, lineKey, NO_NEWLINE_TIP, rowOf, type LineRef } from "./lineSelection";
import { diffKeyAction, type DiffKeyAction } from "./stagingKeys";

/** A hunk header's button: Stage hunk, Unstage hunk or Discard hunk. */
export interface HunkAction {
  label: string;
  /** The hunk whose operation is running, which shows busy. */
  busyHunk: number | null;
  /** Whether any staging operation is running, so the buttons wait. */
  disabled: boolean;
  onAct: (hunk: number) => void;
}

/**
 * The line selection as one pane shows it, and the gestures it reports. Each callback gets this
 * pane's doc, since the split view's panes show different rows.
 */
export interface LineGutter {
  /** The lines a stage or unstage would act on, by `lineKey`. */
  keys: ReadonlySet<string>;
  /** The lines among `keys` that a no-newline marker added. */
  auto: ReadonlySet<string>;
  cursor: LineRef | null;
  /** A gutter press on `row`, with Shift held or not. */
  onPress: (doc: DiffDoc, row: number, shift: boolean) => void;
  /** The button, held since a press on row `from`, is now over row `to`. */
  onDrag: (doc: DiffDoc, from: number, to: number) => void;
  /** The press ended. */
  onRelease: () => void;
  onKey: (doc: DiffDoc, action: DiffKeyAction) => void;
}

export interface DiffEditorProps {
  doc: DiffDoc;
  hunks: Hunk[];
  /** Which line numbers the gutter shows: both for unified, one side for each split pane. */
  numbers: "both" | "old" | "new";
  /** The hunk headers' buttons, in order; none, as in the split view's right pane, shows them bare. */
  actions: readonly HunkAction[];
  ariaLabel: string;
  /** The id of the text that says which keys select lines. */
  ariaDescribedBy?: string;
  /** Null where lines can't be selected. */
  lines: LineGutter | null;
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

type BoxState = "off" | "on" | "auto";

/** A changed line's box in the selection gutter: empty, ticked, or ticked for a no-newline pair. */
class SelectBox extends GutterMarker {
  constructor(readonly state: BoxState) {
    super();
  }
  eq(other: SelectBox) {
    return other.state === this.state;
  }
  toDOM() {
    const box = document.createElement("span");
    box.className = `cm-select-box cm-select-${this.state}`;
    // The gutter is the mouse's way in; the keys reach the same lines through the content.
    box.setAttribute("aria-hidden", "true");
    box.title =
      this.state === "auto" ? NO_NEWLINE_TIP : this.state === "on" ? "Selected: click to deselect" : "Click, Shift-click or drag to select";
    return box;
  }
}

/**
 * The gutter whose boxes a click, Shift-click or drag selects changed lines with. A press reports
 * its row, and while the button is held each move reports the row under the pointer until release.
 */
function selectGutter(doc: DiffDoc, lines: () => LineGutter | null): Extension {
  return gutter({
    class: "cm-select-gutter",
    lineMarker(view, line) {
      const sel = lines();
      const ref = sel && changedAt(doc, view.state.doc.lineAt(line.from).number - 1);
      if (!sel || ref === null) return null;
      const key = lineKey(ref);
      return new SelectBox(sel.auto.has(key) ? "auto" : sel.keys.has(key) ? "on" : "off");
    },
    // The selection arrives with a reconfigure of the decorations.
    lineMarkerChange: (update) => update.transactions.some((tr) => tr.reconfigured),
    initialSpacer: () => new SelectBox("off"),
    domEventHandlers: {
      mousedown(view, line, event) {
        const sel = lines();
        const e = event as MouseEvent;
        if (!sel || e.button !== 0) return false;
        e.preventDefault();
        view.focus();
        const from = view.state.doc.lineAt(line.from).number - 1;
        sel.onPress(doc, from, e.shiftKey);
        let last = from;
        const move = (ev: MouseEvent) => {
          const block = view.lineBlockAtHeight(ev.clientY - view.documentTop);
          const row = view.state.doc.lineAt(block.from).number - 1;
          if (row === last) return;
          last = row;
          lines()?.onDrag(doc, from, row);
        };
        const up = () => {
          window.removeEventListener("mousemove", move);
          window.removeEventListener("mouseup", up);
          lines()?.onRelease();
        };
        if (!e.shiftKey) window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", up);
        return true;
      },
    },
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
    readonly actions: { label: string; busy: boolean; disabled: boolean; onAct: (hunk: number) => void }[]
  ) {
    super();
  }
  eq(other: HunkHeader) {
    return (
      other.index === this.index &&
      other.text === this.text &&
      other.actions.length === this.actions.length &&
      other.actions.every(
        (a, i) => a.label === this.actions[i].label && a.busy === this.actions[i].busy && a.disabled === this.actions[i].disabled
      )
    );
  }
  toDOM() {
    const row = document.createElement("div");
    row.className = "cm-hunk-header";
    const label = document.createElement("span");
    label.className = "cm-hunk-text";
    label.textContent = this.text;
    row.append(label);
    for (const action of this.actions) {
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

function decorations(
  view: { doc: DiffDoc; hunks: Hunk[]; actions: readonly HunkAction[]; lines: LineGutter | null },
  state: EditorState
): Extension {
  const ranges: Range<Decoration>[] = [];
  const sel = view.lines;
  view.doc.lines.forEach((l, i) => {
    const from = state.doc.line(i + 1).from;
    const cls = LINE_CLASS[l.kind];
    if (cls !== null) ranges.push(Decoration.line({ class: cls }).range(from));
    const ref = sel && changedAt(view.doc, i);
    if (!sel || ref === null) return;
    const key = lineKey(ref);
    if (sel.keys.has(key)) {
      const attributes: Record<string, string> = { class: "cm-line-picked" };
      if (sel.auto.has(key)) attributes.title = NO_NEWLINE_TIP;
      ranges.push(Decoration.line({ attributes }).range(from));
    }
    if (sel.cursor !== null && sel.cursor.hunk === ref.hunk && sel.cursor.line === ref.line) {
      ranges.push(Decoration.line({ class: "cm-line-cursor" }).range(from));
    }
  });
  view.doc.hunkStarts.forEach((start, index) => {
    const h = view.hunks[index];
    if (h === undefined || start >= state.doc.lines) return;
    const text = `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@${h.heading ? ` ${h.heading}` : ""}`;
    const widget = new HunkHeader(
      index,
      text,
      view.actions.map((a) => ({ label: a.label, busy: a.busyHunk === index, disabled: a.disabled, onAct: a.onAct }))
    );
    ranges.push(Decoration.widget({ widget, block: true, side: -1 }).range(state.doc.line(start + 1).from));
  });
  return EditorView.decorations.of(Decoration.set(ranges, true));
}

/** The diff view's CodeMirror theme (#383), which the conflict resolver's panes share. */
export const diffTheme = EditorView.theme(
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
    ".cm-select-gutter .cm-gutterElement": { padding: "0 4px", cursor: "pointer" },
    ".cm-select-box": {
      display: "inline-block",
      width: "9px",
      height: "9px",
      marginTop: "4px",
      borderRadius: "2px",
      border: "1px solid #6e7681",
      boxSizing: "border-box",
    },
    ".cm-select-on": { backgroundColor: "#06B6D4", borderColor: "#06B6D4" },
    ".cm-select-auto": { backgroundColor: "#d29922", borderColor: "#d29922" },
    ".cm-line-picked": { boxShadow: "inset 3px 0 0 #06B6D4" },
    ".cm-line-cursor": { outline: "1px dashed #8b949e", outlineOffset: "-1px" },
    "&.cm-focused .cm-line-cursor": { outline: "1px solid #06B6D4" },
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
    "&.cm-focused": { outline: "1px solid #06B6D4", outlineOffset: "-1px" },
  },
  { dark: true }
);

const SELECT_KEYS = "ArrowUp ArrowDown Shift+ArrowUp Shift+ArrowDown Space N P S U";

/**
 * One read-only CodeMirror 6 view of a diff doc: line numbers, add and delete backgrounds, and a
 * header over each hunk with its Stage or Unstage hunk button, and Discard hunk on the unstaged side. With `lines` it adds a selection
 * gutter and the diff keys (#386), which go ahead of CodeMirror's own. The view is rebuilt when the
 * doc changes; a change of busy state or of the selection only swaps its decorations.
 */
export const DiffEditor: React.FC<DiffEditorProps> = ({
  doc,
  hunks,
  numbers,
  actions,
  ariaLabel,
  ariaDescribedBy,
  lines,
  onScroll,
  scrollTop,
}) => {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const decos = useRef(new Compartment());
  const latest = useRef({ onScroll, lines });
  latest.current = { onScroll, lines };
  const selectable = lines !== null;

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const gutters: Extension[] = [];
    if (selectable) gutters.push(selectGutter(doc, () => latest.current.lines));
    if (numbers !== "new") gutters.push(numberGutter(doc.lines, (l) => l.oldNo, "cm-old-numbers"));
    if (numbers !== "old") gutters.push(numberGutter(doc.lines, (l) => l.newNo, "cm-new-numbers"));
    const content: Record<string, string> = { "aria-label": ariaLabel, "aria-readonly": "true" };
    if (selectable) content["aria-keyshortcuts"] = SELECT_KEYS;
    if (ariaDescribedBy) content["aria-describedby"] = ariaDescribedBy;
    const state = EditorState.create({
      doc: doc.text,
      extensions: [
        // Only `\n` ends a line; a CR is shown, not obeyed.
        EditorState.lineSeparator.of("\n"),
        EditorState.readOnly.of(true),
        EditorView.contentAttributes.of(content),
        // Ahead of CodeMirror's keymap, so ↑/↓ move between changed lines rather than the caret.
        Prec.highest(
          EditorView.domEventHandlers({
            keydown(e) {
              const sel = latest.current.lines;
              const act = sel ? diffKeyAction(e) : null;
              if (!sel || act === null) return false;
              e.preventDefault();
              sel.onKey(doc, act);
              return true;
            },
          })
        ),
        gutters,
        diffTheme,
        // Filled by the effect below, so a busy or selection change reconfigures only the decorations.
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
  }, [doc, numbers, ariaLabel, ariaDescribedBy, selectable]);

  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const effects: StateEffect<unknown>[] = [decos.current.reconfigure(decorations({ doc, hunks, actions, lines }, v.state))];
    // The keys move the cursor; keep it in view in the pane they were pressed in.
    const row = lines?.cursor ? rowOf(doc, lines.cursor) : -1;
    if (row >= 0 && v.hasFocus) effects.push(EditorView.scrollIntoView(v.state.doc.line(row + 1).from, { y: "nearest" }));
    v.dispatch({ effects });
  }, [doc, hunks, actions, lines]);

  useEffect(() => {
    const v = view.current;
    if (v && scrollTop !== undefined && Math.abs(v.scrollDOM.scrollTop - scrollTop) > 1) v.scrollDOM.scrollTop = scrollTop;
  }, [scrollTop]);

  return <div ref={host} className="h-full min-h-0 overflow-hidden" />;
};
