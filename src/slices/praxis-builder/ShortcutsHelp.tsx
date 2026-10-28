// The builder's `?` help overlay (#248), generated from the keymap's entries table, so it
// lists exactly the keys the handler runs. Escape closes it, through the builder's cascade.
import { useEffect, useId, useRef, type FC, type Ref } from "react";
import { X } from "lucide-react";
import { chordLabel, KEY_ENTRIES, type KeyEntry, type KeyScope } from "./keymap.ts";
import { focusedElement } from "./keyboard.ts";

const GROUPS: KeyEntry["group"][] = ["General", "Edit", "Canvas", "Node"];

const SCOPE_NOTES: Record<KeyScope, string> = {
  modal: "",
  "outside-text": "Outside text fields",
  canvas: "With focus in the canvas",
  node: "With focus on a node; Tab moves through the nodes, then the edges",
};

export const ShortcutsHelp: FC<{ rootRef: Ref<HTMLDivElement>; onClose: () => void }> = ({ rootRef, onClose }) => {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement | null>(null);
  // Focus goes to Close while it is shown and back to where it was when it closes.
  useEffect(() => {
    const previous = focusedElement();
    closeRef.current?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/60 p-6">
      <div
        ref={rootRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="max-w-lg w-full max-h-full overflow-y-auto rounded-lg border border-[#30363d] bg-[#161b22] p-4 shadow-2xl text-[#c9d1d9]"
      >
        <div className="flex items-center mb-2">
          <h3 id={titleId} className="text-sm font-semibold text-white">
            Keyboard shortcuts
          </h3>
          <button
            ref={closeRef}
            type="button"
            aria-label="Close keyboard shortcuts"
            onClick={onClose}
            className="ml-auto p-1 rounded-md text-[#8b949e] hover:text-white hover:bg-[#21262d]"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
        {GROUPS.map((group) => (
          <section key={group} aria-label={group} className="mt-3">
            <h4 className="text-[10px] font-semibold uppercase tracking-wider text-[#6e7681]">{group}</h4>
            <dl className="mt-1 space-y-1">
              {KEY_ENTRIES.filter((e) => e.group === group).map((entry) => (
                <div key={entry.command} className="flex items-start gap-3 text-xs">
                  <dt className="w-40 shrink-0 flex flex-wrap gap-1">
                    {entry.chords.map((chord) => {
                      const label = chordLabel(chord);
                      return (
                        <kbd key={label} className="px-1.5 py-0.5 rounded border border-[#30363d] bg-[#0d1117] font-mono text-[11px]">
                          {label}
                        </kbd>
                      );
                    })}
                  </dt>
                  <dd className="min-w-0">
                    {entry.label}
                    {SCOPE_NOTES[entry.scope] && (
                      <span className="block text-[10px] text-[#6e7681]">{SCOPE_NOTES[entry.scope]}</span>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </div>
  );
};
