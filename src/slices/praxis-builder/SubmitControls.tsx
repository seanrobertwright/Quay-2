// The Submit bar's controls and the last check's findings, shared by the graph workflow form
// (`GraphSubmit.tsx`, #462) and the trigger form (`TriggerSubmit.tsx`, #476). Each form gives its
// own gates, warnings and finding rows; what they mean is in `hostSubmit.ts`.
import { useId, type ReactNode, type RefObject } from "react";
import { SearchCheck, Send, TriangleAlert } from "lucide-react";
import type { HostCheck } from "./hostSubmit.ts";

const buttonClass =
  "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-[#30363d] bg-[#21262d] hover:bg-[#30363d] text-xs text-white aria-disabled:opacity-40";

/**
 * Check on host and Submit…, the reasons Submit is disabled, each described by it, the warnings
 * that don't disable it, and why the last Submit stopped; `children` follow them.
 */
export function SubmitControls({
  checking,
  reasons,
  warnings,
  stopped,
  onCheck,
  onSubmit,
  submitRef,
  children,
}: {
  /** True while a check, or Submit's reads before the confirm, run: neither button acts then. */
  checking: boolean;
  /** Why Submit is disabled; empty when nothing stops it. */
  reasons: readonly string[];
  warnings: readonly string[];
  stopped: string | null;
  onCheck: () => void;
  onSubmit: () => void;
  submitRef: RefObject<HTMLButtonElement | null>;
  children?: ReactNode;
}) {
  const reasonsId = useId();
  const withheld = reasons.length > 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <button
          type="button"
          // Not `disabled`, which would drop focus while the check runs.
          aria-disabled={checking}
          onClick={onCheck}
          className={buttonClass}
        >
          <SearchCheck className="w-3.5 h-3.5" aria-hidden="true" />
          {checking ? "Checking on host…" : "Check on host"}
        </button>
        <button
          ref={submitRef}
          type="button"
          // Not `disabled`, which would drop focus; the reasons are shown and described.
          aria-disabled={withheld || checking}
          aria-describedby={withheld ? reasonsId : undefined}
          onClick={onSubmit}
          className={buttonClass}
        >
          <Send className="w-3.5 h-3.5" aria-hidden="true" />
          Submit…
        </button>
      </div>
      {withheld && (
        <ul id={reasonsId} className="space-y-0.5 text-[11px] text-[#ff7b72]">
          {reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      {warnings.length > 0 && (
        <ul className="space-y-0.5">
          {warnings.map((w) => (
            <li key={w} className="flex items-start gap-1.5 text-[11px] text-[#e3b341]">
              <TriangleAlert className="w-3.5 h-3.5 mt-px shrink-0" aria-hidden="true" />
              <span>
                <span className="sr-only">Warning: </span>
                {w}
              </span>
            </li>
          ))}
        </ul>
      )}
      {stopped && (
        <p role="alert" className="text-[11px] text-[#ff7b72]">
          {stopped}
        </p>
      )}
      {children}
    </div>
  );
}

/** Keys for findings, which may repeat: each one's `keyOf`, then its count among equal ones. */
function findingKeys<F>(findings: readonly F[], keyOf: (finding: F) => string): string[] {
  const seen = new Map<string, number>();
  return findings.map((f) => {
    const base = keyOf(f);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return `${base}|${n}`;
  });
}

/**
 * What the last check came to: no faults in the saved `subject`, the host's findings, each drawn
 * by `renderFinding` and keyed by `keyOf`, or why it didn't answer.
 */
export function HostFindings<F>({
  check,
  subject,
  keyOf,
  renderFinding,
}: {
  check: HostCheck<F, object>;
  /** What was checked, as the sentences name it: `bundle` or `trigger`. */
  subject: string;
  /** The finding's fields, joined: equal findings get the same. */
  keyOf: (finding: F) => string;
  renderFinding: (finding: F) => ReactNode;
}) {
  let body;
  if (check.kind === "passed") body = <p className="text-[#3fb950]">The host found no faults in the saved {subject}.</p>;
  else if (check.kind === "failed") body = <p className="text-[#ff7b72] break-words">The host&apos;s check didn&apos;t finish: {check.message}</p>;
  else {
    const keys = findingKeys(check.findings, keyOf);
    body = (
      <>
        <p className="text-[#ff7b72]">The host found faults in the saved {subject}.</p>
        <ul className="space-y-0.5">
          {check.findings.map((finding, i) => (
            <li key={keys[i]} className="break-words">
              {renderFinding(finding)}
            </li>
          ))}
        </ul>
      </>
    );
  }
  return (
    <section aria-label="Host findings" className="text-[11px] text-[#c9d1d9] space-y-0.5">
      {body}
    </section>
  );
}
