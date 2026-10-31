import React, { useEffect, useRef } from "react";
import { Annotation, EditorState, Facet, RangeSet, StateEffect, StateField, type Extension, type Range } from "@codemirror/state";
import { Decoration, EditorView, gutter, GutterMarker, lineNumbers } from "@codemirror/view";
import { diffTheme } from "./DiffEditor";
import { keptText, parseConflicts, type ConflictHunk, type HunkChoice, type ParsedConflicts } from "./conflicts";

/** Marks the resolver's own changes, so they never count as a free edit. */
const ours = Annotation.define<boolean>();
/** Marks a replacement of the whole doc from outside (a reset, a reopen), which is not an edit. */
const external = Annotation.define<boolean>();

/** The file's conflict marker size. */
const markerSizeFacet = Facet.define<number, number>({ combine: (values) => values[0] ?? 7 });

/** The Result's hunks, parsed again on every change. */
const parsedField = StateField.define<ParsedConflicts>({
  create: (state) => parseConflicts(state.doc.toString(), state.facet(markerSizeFacet)),
  update: (value, tr) => (tr.docChanged ? parseConflicts(tr.state.doc.toString(), tr.state.facet(markerSizeFacet)) : value),
});

/**
 * A hunk the operator took a side of with a box, tracked so another box can swap the side and
 * unticking puts the markers back. A free edit inside it ends the tracking.
 */
interface Taken {
  from: number;
  to: number;
  /** The hunk's marker text as it was before the box was ticked. */
  original: string;
  hunk: ConflictHunk;
  choice: HunkChoice;
}

const addTaken = StateEffect.define<Taken>();
const swapTaken = StateEffect.define<{ from: number; to: number; choice: HunkChoice }>();
const dropTaken = StateEffect.define<number>();

const takenField = StateField.define<Taken[]>({
  create: () => [],
  update(value, tr) {
    let next = value;
    if (tr.docChanged) {
      const own = tr.annotation(ours) === true;
      next = [];
      for (const t of value) {
        let touched = false;
        tr.changes.iterChangedRanges((fromA, toA) => {
          if (fromA <= t.to && toA >= t.from) touched = true;
        });
        // The resolver's own swaps and drops come as effects below; a free edit ends the tracking.
        if (touched) {
          if (own) next.push(t);
          continue;
        }
        next.push({ ...t, from: tr.changes.mapPos(t.from, 1), to: tr.changes.mapPos(t.to, -1) });
      }
    }
    for (const e of tr.effects) {
      if (e.is(addTaken)) next = [...next, e.value];
      else if (e.is(swapTaken)) next = next.map((t) => (t.from === e.value.from ? { ...t, to: e.value.to, choice: e.value.choice } : t));
      else if (e.is(dropTaken)) next = next.filter((t) => t.from !== e.value);
    }
    return next;
  },
});

const CHOICES: readonly HunkChoice[] = ["left", "right", "both"];

/** The side labels the boxes name, as `role · name`. */
export interface SideNames {
  left: string;
  right: string;
}

/** What each box is called: a letter on screen, and its full name for tooltips and screen readers. */
function boxWords(names: SideNames): Record<HunkChoice, [string, string]> {
  return {
    left: ["L", `Take ${names.left}`],
    right: ["R", `Take ${names.right}`],
    both: ["B", `Take both, ${names.left} first`],
  };
}

/** A hunk's take-left, take-right and take-both boxes, in the Result's gutter on its first line. */
class HunkBoxes extends GutterMarker {
  constructor(
    readonly at: number,
    readonly ordinal: number,
    readonly choice: HunkChoice | null,
    readonly names: SideNames
  ) {
    super();
  }
  eq(other: HunkBoxes) {
    return (
      other.at === this.at &&
      other.ordinal === this.ordinal &&
      other.choice === this.choice &&
      other.names.left === this.names.left &&
      other.names.right === this.names.right
    );
  }
  toDOM(view: EditorView) {
    const row = document.createElement("span");
    row.className = "cm-conflict-boxes";
    const words = boxWords(this.names);
    for (const choice of CHOICES) {
      const [letter, name] = words[choice];
      const label = document.createElement("label");
      label.className = "cm-conflict-box";
      label.title = name;
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = this.choice === choice;
      box.setAttribute("aria-label", `${name} for conflict ${this.ordinal}`);
      box.addEventListener("change", () => choose(view, this.at, choice, box.checked));
      const text = document.createElement("span");
      text.textContent = letter;
      text.setAttribute("aria-hidden", "true");
      label.append(box, text);
      row.append(label);
    }
    return row;
  }
}

/** Ticks or unticks `choice` for the hunk, or the taken hunk, starting at `at`. */
function choose(view: EditorView, at: number, choice: HunkChoice, checked: boolean) {
  const { state } = view;
  if (state.readOnly) return;
  const taken = state.field(takenField).find((t) => t.from === at);
  if (taken) {
    if (!checked) {
      // Unticking puts the conflict back as it was.
      view.dispatch({
        changes: { from: taken.from, to: taken.to, insert: taken.original },
        effects: dropTaken.of(taken.from),
        annotations: ours.of(true),
      });
      return;
    }
    const kept = keptText(taken.hunk, choice);
    view.dispatch({
      changes: { from: taken.from, to: taken.to, insert: kept },
      effects: swapTaken.of({ from: taken.from, to: taken.from + kept.length, choice }),
      annotations: ours.of(true),
    });
    return;
  }
  const hunk = state.field(parsedField).hunks.find((h) => h.from === at);
  if (!hunk || !checked) return;
  const kept = keptText(hunk, choice);
  view.dispatch({
    changes: { from: hunk.from, to: hunk.to, insert: kept },
    effects: addTaken.of({ from: hunk.from, to: hunk.from + kept.length, original: state.sliceDoc(hunk.from, hunk.to), hunk, choice }),
    annotations: ours.of(true),
  });
}

/** The boxes for every hunk still in the text and every taken hunk, numbered in text order. */
function boxGutter(names: () => SideNames): Extension {
  return gutter({
    class: "cm-conflict-gutter",
    markers(view) {
      const { doc } = view.state;
      const starts: { at: number; choice: HunkChoice | null }[] = [];
      const taken = view.state.field(takenField);
      for (const h of view.state.field(parsedField).hunks) {
        if (!taken.some((t) => t.from <= h.from && h.from < t.to)) starts.push({ at: h.from, choice: null });
      }
      for (const t of taken) starts.push({ at: t.from, choice: t.choice });
      starts.sort((a, b) => a.at - b.at);
      const shown = names();
      const marks: Range<GutterMarker>[] = [];
      let lastLine = -1;
      starts.forEach((s, i) => {
        const line = doc.lineAt(s.at).from;
        // Two hunks can't share a line, but an empty taken hunk can sit on the next one's line.
        if (line === lastLine) return;
        lastLine = line;
        marks.push(new HunkBoxes(s.at, i + 1, s.choice, shown).range(line));
      });
      return RangeSet.of(marks);
    },
    initialSpacer: () => new HunkBoxes(0, 1, null, { left: "", right: "" }),
  });
}

/** Backgrounds for each hunk's marker lines and sides, and a bar beside each taken hunk. */
const conflictLines = EditorView.decorations.compute([parsedField, takenField], (state) => {
  const ranges: Range<Decoration>[] = [];
  const { doc } = state;
  /** Marks the lines of [from, to) with `cls`; an empty span marks nothing. */
  const mark = (from: number, to: number, cls: string) => {
    if (from >= to) return;
    const first = doc.lineAt(from).number;
    const last = doc.lineAt(to - 1).number;
    for (let n = first; n <= last; n++) ranges.push(Decoration.line({ class: cls }).range(doc.line(n).from));
  };
  /** The end of the marker line starting at `from`, past its newline. */
  const lineEnd = (from: number) => Math.min(doc.lineAt(from).to + 1, doc.length);
  for (const h of state.field(parsedField).hunks) {
    let at = lineEnd(h.from);
    mark(h.from, at, "cm-conflict-marker");
    mark(at, at + h.left.length, "cm-conflict-left");
    at += h.left.length;
    if (h.base !== null) {
      const end = lineEnd(at);
      mark(at, end, "cm-conflict-marker");
      mark(end, end + h.base.length, "cm-conflict-base");
      at = end + h.base.length;
    }
    const sep = lineEnd(at);
    mark(at, sep, "cm-conflict-marker");
    mark(sep, sep + h.right.length, "cm-conflict-right");
    mark(sep + h.right.length, h.to, "cm-conflict-marker");
  }
  for (const t of state.field(takenField)) mark(t.from, t.to, "cm-conflict-taken");
  return Decoration.set(ranges, true);
});

const resolverTheme = EditorView.theme(
  {
    ".cm-conflict-marker": { backgroundColor: "rgba(210, 153, 34, 0.18)", color: "#e3b341" },
    ".cm-conflict-left": { backgroundColor: "rgba(56, 139, 253, 0.12)" },
    ".cm-conflict-base": { backgroundColor: "rgba(110, 118, 129, 0.15)" },
    ".cm-conflict-right": { backgroundColor: "rgba(188, 140, 255, 0.12)" },
    ".cm-conflict-taken": { boxShadow: "inset 3px 0 0 #2ea043" },
    ".cm-conflict-gutter .cm-gutterElement": { padding: "0 4px" },
    ".cm-conflict-boxes": { display: "inline-flex", gap: "4px", alignItems: "center", height: "18px" },
    ".cm-conflict-box": { display: "inline-flex", alignItems: "center", gap: "1px", fontSize: "10px", color: "#8b949e", cursor: "pointer" },
    ".cm-conflict-box input": { width: "11px", height: "11px", margin: "0", accentColor: "#2ea043", cursor: "pointer" },
    ".cm-content": { caretColor: "#ffffff" },
  },
  { dark: true }
);

export interface ResultEditorProps {
  /** The Result as the operator has it; a different text from outside, such as a reset, replaces the doc. */
  text: string;
  markerSize: number;
  names: SideNames;
  ariaLabel: string;
  /** While a write runs, the Result takes no edits. */
  readOnly: boolean;
  onChange: (text: string) => void;
  /** The view, so the navigator can move between hunks. */
  onView: (view: EditorView | null) => void;
}

/**
 * The editable Result (#390): CodeMirror 6 with line numbers, backgrounds for each hunk's sides,
 * and take-left, take-right and take-both boxes in the gutter on each hunk's first line. The text
 * is the file's own and is only ever set as the doc, never as markup.
 */
export const ResultEditor: React.FC<ResultEditorProps> = ({ text, markerSize, names, ariaLabel, readOnly, onChange, onView }) => {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const latest = useRef({ onChange, names });
  latest.current = { onChange, names };
  const initial = useRef(text);
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const state = EditorState.create({
      doc: initial.current,
      extensions: [
        // Only `\n` ends a line, so offsets match the parser's and a CR stays a CR.
        EditorState.lineSeparator.of("\n"),
        markerSizeFacet.of(markerSize),
        // Edits wait while a write runs; a replacement from outside always lands.
        EditorState.transactionFilter.of((tr) => (readOnlyRef.current && tr.docChanged && !tr.annotation(external) ? [] : tr)),
        EditorView.contentAttributes.of({ "aria-label": ariaLabel, "aria-multiline": "true" }),
        parsedField,
        takenField,
        lineNumbers(),
        boxGutter(() => latest.current.names),
        conflictLines,
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !update.transactions.some((tr) => tr.annotation(external))) {
            latest.current.onChange(update.state.doc.toString());
          }
        }),
        diffTheme,
        resolverTheme,
      ],
    });
    const v = new EditorView({ state, parent: el });
    view.current = v;
    onView(v);
    return () => {
      onView(null);
      v.destroy();
      view.current = null;
    };
  }, [markerSize, ariaLabel, onView]);

  // A text from outside (a reset, a reopen) replaces the doc when it differs from it.
  useEffect(() => {
    const v = view.current;
    if (!v || v.state.doc.toString() === text) return;
    v.dispatch({
      changes: { from: 0, to: v.state.doc.length, insert: text },
      effects: v.state.field(takenField).map((t) => dropTaken.of(t.from)),
      annotations: [external.of(true), ours.of(true)],
    });
  }, [text]);

  return <div ref={host} className="h-full min-h-0 overflow-hidden" />;
};

export interface SidePaneProps {
  text: string;
  ariaLabel: string;
}

/** One side of the conflict, read-only, with line numbers. Its text is only ever set as the doc. */
export const SidePane: React.FC<SidePaneProps> = ({ text, ariaLabel }) => {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const v = new EditorView({
      state: EditorState.create({
        doc: text,
        extensions: [
          EditorState.lineSeparator.of("\n"),
          EditorState.readOnly.of(true),
          EditorView.contentAttributes.of({ "aria-label": ariaLabel, "aria-readonly": "true" }),
          lineNumbers(),
          diffTheme,
        ],
      }),
      parent: el,
    });
    return () => v.destroy();
  }, [text, ariaLabel]);
  return <div ref={host} className="h-full min-h-0 overflow-hidden" />;
};

/**
 * Moves the Result's cursor to the next hunk after the cursor, or the previous one before it,
 * wrapping at either end, and scrolls it into view. Returns its 0-based index, or null with none.
 */
export function goToHunk(view: EditorView, direction: 1 | -1): number | null {
  const { hunks } = view.state.field(parsedField);
  if (hunks.length === 0) return null;
  const head = view.state.selection.main.head;
  let index: number;
  if (direction === 1) {
    index = hunks.findIndex((h) => h.from > head);
    if (index === -1) index = 0;
  } else {
    index = hunks.length - 1;
    while (index >= 0 && hunks[index].from >= head) index--;
    if (index === -1) index = hunks.length - 1;
  }
  const target = hunks[index].from;
  view.dispatch({ selection: { anchor: target }, effects: EditorView.scrollIntoView(target, { y: "center" }) });
  view.focus();
  return index;
}
