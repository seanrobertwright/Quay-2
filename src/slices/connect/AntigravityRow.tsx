import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { AntigravityIcon } from "../terminal/AgentIcons.tsx";
import { Button } from "../parts/Button.tsx";
import { connectAntigravity, readAntigravity, removeAntigravity, useAntigravity } from "./antigravity.ts";
import type { AntigravityConnection, ConnectState } from "./connectTypes.ts";
import { entryLines } from "./entryLines.ts";

/** What the row says of each state, and the colour it says it in. */
const STATE: Record<ConnectState, { words: string; colour: string }> = {
  missing: { words: "Not connected", colour: "text-[#8b949e]" },
  connected: { words: "Connected", colour: "text-[#3fb950]" },
  old_relay: { words: "Old relay", colour: "text-[#d29922]" },
  changed: { words: "Changed", colour: "text-[#d29922]" },
  unreadable: { words: "Can't be read", colour: "text-[#d29922]" },
};

const Entry = ({ text }: { text: string }) => (
  <pre className="p-2 rounded-md border border-[#30363d] bg-[#010409] text-[11px] font-mono text-[#c9d1d9] whitespace-pre-wrap break-all select-text">
    {text}
  </pre>
);

const FilePath = ({ path }: { path: string }) => <code className="text-[#c9d1d9] break-all select-text">{path}</code>;

/** What the file holds and what Connect would write there. */
const Shown = ({ connection }: { connection: AntigravityConnection }) => {
  const { file, entry, state, found, problem } = connection;
  if (state === "unreadable") {
    return (
      <p>
        Quay can't use <FilePath path={file} /> and leaves it as it is: {problem}.
      </p>
    );
  }
  if (found === null) {
    return (
      <>
        <p>
          Quay adds this entry to <FilePath path={file} /> and changes nothing else in the file. Remove takes the same entry out. Antigravity
          starts the relay it names in every session; outside Quay it has no tools.
        </p>
        <Entry text={entry} />
      </>
    );
  }
  if (state === "connected") {
    return (
      <>
        <p>
          <FilePath path={file} /> has Quay's entry. Remove takes it out and changes nothing else in the file.
        </p>
        <Entry text={entryLines(found)} />
        <p>Relaunch an Antigravity terminal that is already open.</p>
      </>
    );
  }
  return (
    <>
      <p>
        The entry in <FilePath path={file} />
        {state === "old_relay" ? " names a relay that is not this Quay's:" : " is not the one Quay writes:"}
      </p>
      <Entry text={entryLines(found)} />
      <p>Remove takes it out. Connect again puts this in its place, and neither changes anything else in the file:</p>
      <Entry text={entry} />
    </>
  );
};

interface AntigravityRowProps {
  /** Each new value opens the row and focuses it. */
  openRequest?: number;
}

/**
 * The Connect row: whether Antigravity is connected, and, opened in place, its file's path, the exact
 * entry, Connect and Remove. It draws nothing in a build that offers no surfaces.
 */
export const AntigravityRow = ({ openRequest }: AntigravityRowProps) => {
  const connection = useAntigravity();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const button = useRef<HTMLButtonElement | null>(null);
  const opened = useRef<number | undefined>(undefined);
  const detailId = useId();

  useEffect(() => {
    void readAntigravity();
  }, []);

  const drawn = connection !== null;
  useEffect(() => {
    if (openRequest === undefined || openRequest === opened.current || !drawn) return;
    opened.current = openRequest;
    setRefused(null);
    setOpen(true);
    button.current?.focus();
    void readAntigravity();
  }, [openRequest, drawn]);

  if (!connection) return null;
  const { state, found } = connection;

  const toggle = () => {
    setRefused(null);
    setOpen(!open);
    if (!open) void readAntigravity();
  };
  const act = async (what: () => Promise<unknown>) => {
    setBusy(true);
    setRefused(null);
    try {
      await what();
    } catch (error) {
      setRefused(String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="text-[11px] text-[#8b949e]">
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={open ? detailId : undefined}
        onClick={toggle}
        className="w-full min-h-10 flex items-center gap-2.5 px-2.5 rounded-md text-left text-xs text-[#c9d1d9] hover:bg-[#161b22] hover:text-white transition-colors"
      >
        <AntigravityIcon className="w-4 h-4 shrink-0 text-[#38bdf8]" />
        <span className="flex-1 truncate">Antigravity</span>
        <span className={`shrink-0 text-[11px] ${STATE[state].colour}`}>{STATE[state].words}</span>
        {open ? <ChevronDown className="w-3.5 h-3.5 shrink-0" aria-hidden="true" /> : <ChevronRight className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />}
      </button>
      {open && (
        <div id={detailId} role="group" aria-label="Connect Antigravity" className="px-2.5 pt-1 pb-2 flex flex-col gap-2">
          <Shown connection={connection} />
          {refused && (
            <p role="alert" className="text-[#ff7b72]">
              {refused}
            </p>
          )}
          <div className="flex gap-2">
            {state === "missing" && (
              <Button variant="primary" disabled={busy} onClick={() => void act(() => connectAntigravity(found))}>
                Connect
              </Button>
            )}
            {(state === "old_relay" || state === "changed") && (
              <Button variant="primary" disabled={busy} onClick={() => void act(() => connectAntigravity(found))}>
                Connect again
              </Button>
            )}
            {found !== null && (
              <Button disabled={busy} onClick={() => void act(() => removeAntigravity(found))}>
                Remove
              </Button>
            )}
            {state === "unreadable" && (
              <Button disabled={busy} onClick={() => void act(readAntigravity)}>
                Read it again
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
