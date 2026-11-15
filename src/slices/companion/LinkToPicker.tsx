import { useId, useRef, useState } from "react";
import type { LinkRef, LinkSlotName } from "../terminal/types.ts";
import type { LinkChoice } from "./linkChoices.ts";
import { refText, SLOT_LABELS } from "./TerminalLinkBar.tsx";

/**
 * The Repository view's Link to... control: a button that opens a list of guesses, with a search
 * field whose results replace them. Picking a choice pins it and closes the list.
 */
export const LinkToPicker = ({
  choices,
  onOpen,
  onPick,
}: {
  /** The guesses when `query` is empty, else the search results. */
  choices: (query: string) => readonly LinkChoice[];
  /** Called each time the list opens, to fetch what it offers. */
  onOpen: () => void;
  onPick: (slot: LinkSlotName, ref: LinkRef) => void;
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const listId = useId();
  const toggle = useRef<HTMLButtonElement | null>(null);
  const close = () => {
    setOpen(false);
    setQuery("");
    toggle.current?.focus();
  };
  const shown = open ? choices(query) : [];
  return (
    <div className="space-y-2">
      <button
        ref={toggle}
        type="button"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => {
          if (open) {
            close();
          } else {
            setOpen(true);
            onOpen();
          }
        }}
        className="min-h-6 px-2.5 rounded border border-[#30363d] text-[#c9d1d9] hover:border-[#58a6ff] hover:text-white"
      >
        Link to...
      </button>
      {open && (
        // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- Escape anywhere in the open list closes it
        <div
          id={listId}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              close();
            }
          }}
          className="rounded border border-[#30363d] bg-[#161b22] p-2 space-y-2"
        >
          <input
            type="search"
            aria-label="Search tickets and pull requests"
            placeholder="Number, owner/name#N, or words"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full min-h-6 px-2 rounded bg-[#0d1117] border border-[#30363d] text-[#c9d1d9] placeholder:text-[#6e7681]"
          />
          {shown.length === 0 ? (
            <p className="text-[#8b949e]">{query.trim() ? "No matches." : "No guesses. Search by number or title."}</p>
          ) : (
            <ul aria-label={query.trim() ? "Search results" : "Guesses"} className="space-y-0.5">
              {shown.map((choice) => (
                <li key={`${choice.slot}:${refText(choice.ref)}`}>
                  <button
                    type="button"
                    onClick={() => {
                      onPick(choice.slot, choice.ref);
                      close();
                    }}
                    className="w-full min-h-6 px-2 text-left rounded hover:bg-[#30363d] truncate"
                  >
                    <span className="text-white">{`${SLOT_LABELS[choice.slot]} ${refText(choice.ref)}`}</span>
                    {choice.label && <span className="text-[#8b949e]">{` ${choice.label}`}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};
