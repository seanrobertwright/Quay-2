import React, { useEffect, useId, useRef, useState, type RefObject } from "react";
import { Gauge, X } from "lucide-react";
import { usePopupLayer } from "../../overlay/useOverlay";
import { SPEEDUP_COMMANDS, type SpeedupItem } from "./speedup";
import type { Speedup } from "./useSpeedup";

/** What each item does, beside its exact command (#369). */
const ITEM_TEXT: Record<SpeedupItem, { title: string; detail: string }> = {
  commitGraph: {
    title: "Write a commit-graph",
    detail: "Lets git list commits without opening each one. It changes no config, and you can cancel it.",
  },
  fsmonitor: {
    title: "Turn on git's file system monitor",
    detail: "Starts a background git process that watches this repo's files, so git status doesn't scan them.",
  },
  untrackedCache: {
    title: "Turn on the untracked cache",
    detail: "Remembers which folders hold no new files, so git status skips them.",
  },
};

/** The items ticked when the dialog opens: all but fsmonitor, which starts a background process. */
function initiallyTicked(items: SpeedupItem[]): Set<SpeedupItem> {
  return new Set(items.filter((item) => item !== "fsmonitor"));
}

/** The banner above the graph (#385): "This repo is large. Speed up Topos…". */
export const SpeedupBanner: React.FC<{ speedup: Speedup; onOpen: () => void }> = ({ speedup, onOpen }) => (
  <div
    role="region"
    aria-label="Speed-up suggestion"
    className="px-4 py-1.5 flex items-center gap-3 text-xs text-[#c9d1d9] bg-[#06B6D4]/10 border-b border-[#06B6D4]/30 shrink-0"
  >
    <Gauge className="w-3.5 h-3.5 text-[#06B6D4] shrink-0" aria-hidden="true" />
    <span className="min-w-0 truncate">
      This repo is large.{" "}
      <button type="button" onClick={onOpen} className="underline text-[#58a6ff] hover:text-white">
        Speed up Topos…
      </button>
    </span>
    <button
      type="button"
      onClick={speedup.suppress}
      className="ml-auto px-1.5 rounded border border-[#30363d] text-[#8b949e] hover:text-white hover:bg-[#21262d] shrink-0"
    >
      Don't suggest for this repo
    </button>
    <button
      type="button"
      onClick={speedup.dismiss}
      aria-label="Dismiss the speed-up suggestion"
      title="Dismiss"
      className="p-0.5 rounded text-[#8b949e] hover:text-white hover:bg-[#21262d] shrink-0"
    >
      <X className="w-3.5 h-3.5" aria-hidden="true" />
    </button>
  </div>
);

export interface SpeedupDialogProps {
  open: boolean;
  speedup: Speedup;
  onClose: () => void;
  /** Takes focus on close when what had it, such as the banner, has gone. */
  fallbackFocus: RefObject<HTMLElement | null>;
}

/**
 * The speed-up dialog (#369, #385): a checkbox per item with its exact command. Nothing is written
 * until "Apply selected", and then only the ticked items. Focus is trapped inside it, and goes back
 * where it was once it closes. While an apply runs it stays open, and Cancel stops the job.
 */
export const SpeedupDialog: React.FC<SpeedupDialogProps> = ({ open, speedup, onClose, fallbackFocus }) => {
  const titleId = useId();
  const detailId = useId();
  const idPrefix = useId();
  const panel = useRef<HTMLDivElement>(null);
  const items = speedup.check?.items ?? [];
  const [ticked, setTicked] = useState<Set<SpeedupItem>>(() => initiallyTicked(items));
  const running = speedup.apply.state === "running";
  const close = () => {
    if (running) return;
    speedup.reset();
    onClose();
  };
  usePopupLayer(open, close, panel);

  // Each open starts from the items offered now.
  const itemsKey = items.join(",");
  useEffect(() => {
    if (open) setTicked(initiallyTicked(itemsKey === "" ? [] : (itemsKey.split(",") as SpeedupItem[])));
  }, [open, itemsKey]);

  useEffect(() => {
    if (!open) return;
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const fallback = fallbackFocus.current;
    const node = panel.current;
    node?.querySelector<HTMLElement>("input, button")?.focus();
    // Focus is trapped: Tab from the last control goes to the first, and Shift+Tab the other way.
    const trap = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || node === null) return;
      const controls = [...node.querySelectorAll<HTMLElement>("input:not(:disabled), button:not(:disabled)")];
      if (controls.length === 0) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      const inside = controls.includes(document.activeElement as HTMLElement);
      if (e.shiftKey && (document.activeElement === first || !inside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (document.activeElement === last || !inside)) {
        e.preventDefault();
        first.focus();
      }
    };
    node?.addEventListener("keydown", trap);
    return () => {
      node?.removeEventListener("keydown", trap);
      if (before?.isConnected) before.focus();
      else fallback?.focus();
    };
  }, [open, fallbackFocus]);

  // Apply and Cancel swap places as a job starts and ends, so focus moves with them.
  const cancelButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    if (running) cancelButton.current?.focus();
    else if (!panel.current?.contains(document.activeElement)) panel.current?.querySelector<HTMLElement>("input, button")?.focus();
  }, [open, running]);

  if (!open) return null;

  const toggle = (item: SpeedupItem) =>
    setTicked((current) => {
      const next = new Set(current);
      if (next.has(item)) next.delete(item);
      else next.add(item);
      return next;
    });

  const chosen = items.filter((item) => ticked.has(item));
  const applySelected = () => {
    void speedup.run(chosen).then((done) => {
      if (done) onClose();
    });
  };

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50">
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={detailId}
        className="w-full max-w-lg bg-[#161b22] border border-[#30363d] rounded-lg shadow-2xl p-4 flex flex-col gap-3"
      >
        <h3 id={titleId} className="text-sm font-semibold text-white">
          Speed up Topos
        </h3>
        <p id={detailId} className="text-xs text-[#8b949e]">
          Topos runs only the commands you tick, and only once you press Apply selected.
        </p>
        <fieldset disabled={running} className="flex flex-col gap-2">
          <legend className="sr-only">Speed-ups for this repo</legend>
          {items.map((item) => {
            const inputId = `${idPrefix}-${item}`;
            const detail = `${idPrefix}-${item}-detail`;
            return (
              <div key={item} className="flex items-start gap-2 p-2 rounded-md border border-[#30363d] bg-[#0d1117]">
                <input
                  id={inputId}
                  type="checkbox"
                  checked={ticked.has(item)}
                  onChange={() => toggle(item)}
                  aria-describedby={detail}
                  className="mt-0.5 accent-[#06B6D4]"
                />
                <div className="flex flex-col gap-1 min-w-0">
                  <label htmlFor={inputId} className="text-xs font-semibold text-white">
                    {ITEM_TEXT[item].title}
                  </label>
                  <code className="text-[11px] font-mono text-[#e3b341] break-all">{SPEEDUP_COMMANDS[item]}</code>
                  <span id={detail} className="text-[11px] text-[#8b949e]">
                    {ITEM_TEXT[item].detail}
                  </span>
                </div>
              </div>
            );
          })}
        </fieldset>
        {speedup.apply.state === "running" && (
          <p role="status" className="text-xs text-[#c9d1d9] truncate">
            {speedup.apply.line ?? "Starting…"}
          </p>
        )}
        {speedup.apply.state === "failed" && (
          <p role="alert" className="text-xs text-[#f85149] break-words">
            {speedup.apply.message}
          </p>
        )}
        <div className="flex justify-end gap-2">
          {running ? (
            <button
              ref={cancelButton}
              type="button"
              onClick={speedup.cancel}
              className="px-3 py-1.5 rounded-md text-xs text-[#c9d1d9] border border-[#30363d] hover:bg-[#21262d] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#06B6D4]/60"
            >
              Cancel
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={close}
                className="px-3 py-1.5 rounded-md text-xs text-[#c9d1d9] hover:bg-[#21262d] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#06B6D4]/60"
              >
                Close
              </button>
              <button
                type="button"
                onClick={applySelected}
                disabled={chosen.length === 0}
                className="px-3 py-1.5 rounded-md text-xs font-semibold bg-[#238636] hover:bg-[#2ea043] disabled:opacity-50 disabled:hover:bg-[#238636] text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/60"
              >
                Apply selected
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
