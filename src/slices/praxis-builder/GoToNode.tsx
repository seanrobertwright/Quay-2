// Go to node (#248): `Mod+F` anywhere in the builder opens it over the graph. Typing filters
// the nodes by id or kind; the arrow keys move through the list, and Enter or a click selects
// the node and zooms to it. Escape closes it, through the builder's cascade, and focus goes
// back to where it was.
import { useEffect, useId, useRef, useState, type FC, type KeyboardEvent, type Ref } from "react";
import { focusedElement, GO_TO_LIMIT, matchNodes } from "./keyboard.ts";

export interface GoToEntry {
  id: string;
  kind: string;
}

export const GoToNode: FC<{
  rootRef: Ref<HTMLDivElement>;
  /** The open graph's nodes, in file order. */
  nodes: readonly GoToEntry[];
  onPick: (nodeId: string) => void;
}> = ({ rootRef, nodes, onPick }) => {
  const titleId = useId();
  const listId = useId();
  const optionId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [text, setText] = useState("");
  const [active, setActive] = useState(0);
  const { matches, more } = matchNodes(nodes, text);
  const current = matches.length === 0 ? -1 : Math.min(active, matches.length - 1);

  useEffect(() => {
    const previous = focusedElement();
    inputRef.current?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  // Keep the active option in view as the arrow keys move it.
  useEffect(() => {
    if (current >= 0) document.getElementById(`${optionId}-${current}`)?.scrollIntoView({ block: "nearest" });
  }, [current, optionId]);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (matches.length > 0) setActive((current + (e.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length);
    } else if (e.key === "Enter" && current >= 0) {
      e.preventDefault();
      onPick(matches[current].id);
    }
  };

  return (
    <div className="absolute inset-0 z-20 flex items-start justify-center bg-black/60 p-6 pt-24">
      <div
        ref={rootRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="max-w-md w-full rounded-lg border border-[#30363d] bg-[#161b22] p-3 shadow-2xl text-[#c9d1d9]"
      >
        <h3 id={titleId} className="text-sm font-semibold text-white mb-2">
          Go to node
        </h3>
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-labelledby={titleId}
          aria-autocomplete="list"
          aria-expanded={matches.length > 0}
          aria-controls={matches.length > 0 ? listId : undefined}
          aria-activedescendant={current >= 0 ? `${optionId}-${current}` : undefined}
          spellCheck={false}
          autoComplete="off"
          placeholder="Node id or kind"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          className="w-full px-2 py-1.5 rounded-md bg-[#0d1117] border border-[#30363d] text-xs font-mono focus:outline-none focus:border-[#58a6ff]"
        />
        {matches.length > 0 ? (
          <ul id={listId} role="listbox" aria-label="Nodes" className="mt-2 max-h-72 overflow-y-auto text-xs">
            {matches.map((n, i) => (
              // The input keeps focus and its keys, as the combobox pattern has it.
              // eslint-disable-next-line jsx-a11y/click-events-have-key-events
              <li
                key={n.id}
                id={`${optionId}-${i}`}
                role="option"
                aria-selected={i === current}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onPick(n.id)}
                className={`px-2 py-1 rounded flex gap-3 cursor-pointer ${i === current ? "bg-[#1f6feb]/30 text-white" : "hover:bg-[#21262d]"}`}
              >
                <span className="font-mono truncate">{n.id}</span>
                <span className="ml-auto shrink-0 text-[10px] text-[#8b949e]">{n.kind || "No kind"}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-xs text-[#8b949e]">{nodes.length === 0 ? "This graph has no nodes." : "No node matches."}</p>
        )}
        {more && (
          <p className="mt-1 text-[10px] text-[#6e7681]">Showing the first {GO_TO_LIMIT} matches. Type to narrow them.</p>
        )}
      </div>
    </div>
  );
};
