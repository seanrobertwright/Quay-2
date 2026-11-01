// A template run's detail (#362, #453): the run drawn live on the template's read-only stage
// strip, followed while it is on screen. Decisions on a run (approve, pause, cancel, resolving a
// hold) are made only in the host's browser page, so the detail has no control for any of them,
// not even a disabled one: it shows where the run is and opens its page. Quay never runs
// `praxis hold` or `praxis open`, and runs `praxis trust` only in a visible terminal.
import { useId, useState, type FC, type ReactNode } from "react";
import { ExternalLink, FlaskConical, Pause, ShieldCheck, UserCheck, X } from "lucide-react";
import { formatClock } from "../../lib/dates.ts";
import type { JsonObject } from "./model.ts";
import { openPraxisTerminal, type RunInTerminal } from "./praxisHost.ts";
import type { RunDetail as Run } from "./runDetail.ts";
import { openRunPageOf } from "./runPage.ts";
import type { RunPageLookup, RunRow } from "./runsList.ts";
import { StageStrip } from "./StageStrip.tsx";
import { useRunDetail } from "./useRunDetail.ts";

interface RunDetailProps {
  projectPath: string;
  workOrderId: string;
  /** The run's row from the Runs list's last read; the fallback for what `status` doesn't give. */
  row: RunRow | null;
  /** The template's content, whose stages the strip draws. */
  content: JsonObject;
  /** True while the Runs view is on screen. */
  shown: boolean;
  /** Looks up the run's page when `status` hasn't given it yet. */
  runPage: (workOrderId: string) => Promise<RunPageLookup>;
  runInTerminal?: RunInTerminal;
  onClose: () => void;
}

const BUTTON = "inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-[#30363d] bg-[#21262d] hover:bg-[#30363d] text-[11px] text-white";
/** The amber of a caution: a simulated run, or one waiting for a person. */
export const AMBER = "border-[#d29922]/70 text-[#e3b341] bg-[#d29922]/10";

export const RunDetail: FC<RunDetailProps> = ({ projectPath, workOrderId, row, content, shown, runPage, runInTerminal, onClose }) => {
  const view = useRunDetail(projectPath, workOrderId, row, shown);
  const [notice, setNotice] = useState<string | null>(null);
  const run = view.run;
  const name = run?.runId ?? row?.runId ?? workOrderId;

  const openInBrowser = async () => {
    setNotice(null);
    setNotice(await openRunPageOf(name, run?.runPageAddress ?? null, () => runPage(workOrderId)));
  };

  const trust = () => {
    setNotice(null);
    const failed = (why: string) => setNotice(`Couldn't open a terminal for praxis trust: ${why}`);
    if (!runInTerminal) return failed("this window has no terminals.");
    openPraxisTerminal("trust", projectPath, runInTerminal).then(
      (typed) => {
        if (!typed) failed("the command can't be typed into a terminal safely.");
      },
      (e) => failed(String(e)),
    );
  };

  const openButton = (label: string) => (
    <button type="button" onClick={() => void openInBrowser()} aria-label={`${label} for ${name}`} className={BUTTON}>
      <ExternalLink className="w-3 h-3" aria-hidden="true" />
      {label}
    </button>
  );

  const readAt = view.readAt === null ? null : formatClock(view.readAt);
  return (
    <section aria-label={`Run ${name}`} className="space-y-3 rounded-md border border-[#30363d] p-3">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#c9d1d9]">
        <h3 className="font-mono font-semibold">
          {name}
        </h3>
        {run && <span>{run.status}</span>}
        {run && (
          <span className="inline-flex items-center gap-1">
            <span className="sr-only">Control </span>
            <span data-chip="control" className="px-1.5 py-px rounded-full border border-[#30363d] bg-[#21262d] text-[10px]">
              {run.control}
            </span>
          </span>
        )}
        {run?.held && (
          <span className="inline-flex items-center gap-1 px-1.5 py-px rounded-full border border-[#f0883e]/60 text-[#f0883e] text-[10px]">
            <Pause className="w-3 h-3" aria-hidden="true" />
            Held
          </span>
        )}
        {run?.revision !== null && run?.revision !== undefined && <span className="text-[#8b949e]">revision {run.revision}</span>}
        {run?.simulated && <span className={`px-1.5 py-px rounded-full border text-[10px] ${AMBER}`}>Simulated</span>}
        <span className="ml-auto inline-flex items-center gap-2">
          {openButton("Open in browser")}
          <button type="button" onClick={onClose} aria-label={`Close ${name}`} className={BUTTON}>
            <X className="w-3 h-3" aria-hidden="true" />
            Close
          </button>
        </span>
      </header>
      <div role="status" className="text-[11px] text-[#8b949e] space-y-1">
        {view.readAt === null && view.problem === null && <p>Reading {name} on the host…</p>}
        {view.dimmed && (
          <p className="text-[#f85149]">
            The host can't be used, so this run may be out of date{readAt ? `: it was read at ${readAt}` : ""}. {view.problem}
          </p>
        )}
        {!view.dimmed && view.problem && <p className="text-[#f85149]">{view.problem}</p>}
        {!view.dimmed && readAt && <p>{run?.ended ? `Read at ${readAt}. The run has ended, so it is no longer read.` : `Read at ${readAt}.`}</p>}
        {notice && <p className="text-[#f85149]">{notice}</p>}
      </div>
      {run && (
        <div className={view.dimmed ? "opacity-50" : ""}>
          <StageStrip
            content={content}
            progress={{ runId: name, current: run.current, finished: run.finished, held: run.held, corrections: run.corrections }}
          />
        </div>
      )}
      {run?.hold && <HoldPanel run={run} openButton={openButton("Resolve in browser")} onTrust={trust} />}
      {run && run.waiting && !run.hold && <WaitingBanner run={run} openButton={openButton("Open in browser")} onTrust={trust} />}
    </section>
  );
};

/** The certificate hint praxis gave, with Trust certificate when it asks for `praxis trust`. */
const CertificateHint: FC<{ run: Run; onTrust: () => void }> = ({ run, onTrust }) =>
  run.trustHint === null ? null : (
    <p className="flex flex-wrap items-center gap-2 text-[11px] text-[#e3b341]">
      <span>{run.trustHint}</span>
      {run.offersTrust && (
        <button type="button" onClick={onTrust} className={BUTTON}>
          <ShieldCheck className="w-3 h-3" aria-hidden="true" />
          Trust certificate
        </button>
      )}
    </p>
  );

/** A run that waits for a person: what it waits for, decided in the browser. */
const WaitingBanner: FC<{ run: Run; openButton: ReactNode; onTrust: () => void }> = ({ run, openButton, onTrust }) => (
  <div role="region" aria-label="Waiting for a decision" className="space-y-1.5 px-3 py-2 rounded-md border border-[#1f6feb]/60 bg-[#1f6feb]/10">
    <p className="flex flex-wrap items-center gap-2 text-xs text-[#c9d1d9]">
      <UserCheck className="w-3.5 h-3.5 text-[#79c0ff]" aria-hidden="true" />
      <span>
        {run.decisions.length > 0
          ? `This run waits for ${run.decisions.join(", ")}, decided in the browser.`
          : "This run waits for a decision, made in the browser."}
      </span>
      {openButton}
    </p>
    {run.simulated && (
      <p className={`flex items-start gap-1.5 px-2 py-1 rounded-md border text-[11px] ${AMBER}`}>
        <FlaskConical className="w-3.5 h-3.5 mt-px shrink-0" aria-hidden="true" />
        This host is simulated: its decisions aren't made by a person.
      </p>
    )}
    <CertificateHint run={run} onTrust={onTrust} />
  </div>
);

/** A held run's hold card: why it is held and the exits it offers, all taken in the browser. */
const HoldPanel: FC<{ run: Run; openButton: ReactNode; onTrust: () => void }> = ({ run, openButton, onTrust }) => {
  const hold = run.hold;
  const headingId = useId();
  if (!hold) return null;
  return (
    <div role="region" aria-labelledby={headingId} className="space-y-1.5 px-3 py-2 rounded-md border border-[#f0883e]/60 bg-[#f0883e]/10 text-xs text-[#c9d1d9]">
      <p className="flex flex-wrap items-center gap-2">
        <Pause className="w-3.5 h-3.5 text-[#f0883e]" aria-hidden="true" />
        <span id={headingId} className="font-semibold">
          Held: {hold.reason}
        </span>
        {openButton}
      </p>
      {hold.cause && <p>{hold.cause}</p>}
      {hold.phase && <p className="text-[#8b949e]">{hold.phase}</p>}
      {hold.evidence && <p className="text-[#8b949e]">{hold.evidence}</p>}
      {hold.notes.length > 0 && (
        <ul className="list-disc pl-5 text-[#8b949e]">
          {hold.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
      {hold.exits.length > 0 && (
        <>
          <p className="text-[#8b949e]">Ways out of the hold, taken in the browser:</p>
          <ul aria-label="Ways out of the hold" className="list-disc pl-5">
            {hold.exits.map((exit) => (
              <li key={exit.id}>
                <span className="font-medium">{exit.label}</span>
                {exit.does && `: ${exit.does}`}
                {!exit.available && <span className="text-[#8b949e]"> (not available now)</span>}
              </li>
            ))}
          </ul>
        </>
      )}
      <CertificateHint run={run} onTrust={onTrust} />
    </div>
  );
};
