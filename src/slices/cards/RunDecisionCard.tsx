import { CircleCheck, CircleX, ExternalLink, RotateCw } from "lucide-react";
import { Button } from "../parts/Button.tsx";
import { ArchonGateCard } from "./ArchonGateCard.tsx";
import { AttributedText } from "./AttributedText.tsx";
import { HoldCard } from "./HoldCard.tsx";
import { PressTwice } from "./PressTwice.tsx";
import { QuayCard } from "./QuayCard.tsx";
import type { RunDecision } from "./runDecision.ts";

/** Runs a decision's command; `label` names the decision if it fails. */
export type DecisionAct = (label: string, command: string, args: Record<string, unknown>) => Promise<void>;

interface RunDecisionCardProps {
  decision: RunDecision;
  /** True while a decision is on its way. */
  busy: boolean;
  act: DecisionAct;
  /** Opens the run lens on this run. */
  onOpenLens: () => void;
  /** Opens a Praxis run's page, where its decisions are made. */
  onOpenInBrowser: () => void;
}

const NOTE = "text-[11px] text-[#8b949e]";

/** The Quay card for the decision a run or work order waits on. */
export const RunDecisionCard = ({ decision, busy, act, onOpenLens, onOpenInBrowser }: RunDecisionCardProps) => {
  switch (decision.kind) {
    case "archon-approval": {
      const { runId } = decision;
      return (
        <ArchonGateCard
          runId={runId}
          busy={busy}
          onOpenLens={onOpenLens}
          onDecide={(action, comment) => act(action === "approve" ? "Approve" : "Reject", "archon_run_action", { runId, action, text: comment })}
        />
      );
    }
    case "archon-failed": {
      const { runId } = decision;
      return (
        <QuayCard title="This run failed." icon={CircleX}>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" disabled={busy} onClick={() => void act("Resume", "archon_run_action", { runId, action: "resume", text: null })}>
              Resume
            </Button>
            <PressTwice
              label="Abandon"
              armedLabel="Press again to abandon"
              disabled={busy}
              onConfirm={() => void act("Abandon", "archon_run_action", { runId, action: "abandon", text: null })}
            />
          </div>
        </QuayCard>
      );
    }
    case "factory-hold": {
      const { workOrderId, hold } = decision;
      return (
        <HoldCard
          hold={hold}
          busy={busy}
          onChoose={(option) => void act(option.label, "machina_resolve_hold", { request: { workOrderId, optionId: option.id } })}
        />
      );
    }
    case "factory-accept": {
      const { workOrderId, baseBranch, repoPath } = decision;
      return (
        <QuayCard title="The gate passed." icon={CircleCheck}>
          <AttributedText label="The work order's base branch" text={baseBranch} />
          <AttributedText label="The work order's main checkout" text={repoPath} />
          {/* The branch's name is cut to the card's width; the box above has all of it. */}
          <div className="grid grid-cols-[minmax(0,max-content)]">
            <Button variant="primary" disabled={busy} onClick={() => void act("Accept", "machina_accept_and_merge", { workOrderId })}>
              <span className="block truncate">Accept: squash-merge into {baseBranch}</span>
            </Button>
          </div>
          <p className={NOTE}>The main checkout must be on the base branch with no uncommitted changes to tracked files.</p>
        </QuayCard>
      );
    }
    case "factory-resume": {
      const { workOrderId, failed } = decision;
      return (
        <QuayCard title={failed ? "This work order failed." : "This work order was interrupted."} icon={RotateCw}>
          <Button variant="primary" disabled={busy} onClick={() => void act("Resume", "machina_resume", { workOrderId })}>
            Resume
          </Button>
        </QuayCard>
      );
    }
    case "praxis-browser":
      return (
        <QuayCard title="This run waits on you in Praxis." icon={ExternalLink}>
          <p className={NOTE}>Praxis decisions are made on the host&apos;s page, in the browser.</p>
          <Button variant="primary" onClick={onOpenInBrowser}>
            Open in browser
          </Button>
        </QuayCard>
      );
  }
};
