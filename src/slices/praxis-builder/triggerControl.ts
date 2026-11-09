// The controls any session may use on a graph trigger on the Praxis host (#469, #477): Withdraw a
// pending candidate, Disable an enabled trigger and Retire one, through the Praxis CLI runner's
// trigger commands (#474). Enabling is the owner's decision, so Quay never enables, admits or
// rejects: it finds the trigger's review page for Enable in browser instead.
//
// Each write rereads the trigger through the trigger host model (#475) once the host has answered,
// and resolves when that read is in, so the state the form shows afterwards is the host's. A
// refusal says why in the host's words. A write praxis couldn't confirm is unknown, and the next
// one of the same kind resends its request id. A repeat while one is in flight joins it.
//
// Writes aren't cancelled when the builder closes: a write killed half way would only leave its
// outcome unknown. So the model holds no calls to dispose.
import { invoke } from "@tauri-apps/api/core";
import { outcomeMessage, writeOutcomeOf, type CallOutcome, type Invoker, type WriteOutcome, type WriteWords } from "./praxisHost.ts";
import type { TriggerHost } from "./triggerHost.ts";

/** Where a trigger's review page is, or why Quay couldn't find it. */
export type ReviewPage = { kind: "address"; address: string } | { kind: "problem"; message: string };

export interface TriggerControl {
  /** Withdraws pending candidate `revision` of `name` (`praxis triggers withdraw`), then rereads it. */
  withdraw(name: string, revision: number): Promise<WriteOutcome>;
  /**
   * Disables `name` (`praxis triggers disable`), then rereads it. praxis sends no revision, so the
   * host disables the trigger as it stands when the request lands.
   */
  disable(name: string): Promise<WriteOutcome>;
  /** Retires `name` (`praxis triggers retire`), then rereads it. Like disabling, it acts on the trigger as it stands. */
  retire(name: string): Promise<WriteOutcome>;
  /**
   * The address praxis gives for revision `revision`'s review page (`praxis triggers show
   * --revision`), where the owner enables a disabled trigger. It writes nothing.
   */
  reviewPage(name: string, revision: number): Promise<ReviewPage>;
}

export interface TriggerControlOptions {
  projectPath: string;
  /** The trigger host model, which rereads a trigger after each write. */
  triggers: TriggerHost;
  call?: Invoker;
}

/** One kind of write: its command, its in-flight and unconfirmed key, and how its outcome names it. */
interface Write extends WriteWords {
  command: string;
  args: Record<string, unknown>;
  /** The write's key: its kind, the trigger and, for a withdrawal, the revision. */
  key: string;
}

export function createTriggerControl({ projectPath, triggers, call = invoke }: TriggerControlOptions): TriggerControl {
  const inFlight = new Map<string, Promise<WriteOutcome>>();
  // The request id of each write praxis couldn't confirm, by its key, to resend.
  const unconfirmed = new Map<string, string>();

  async function praxis(command: string, args: Record<string, unknown>): Promise<CallOutcome> {
    try {
      return (await call(command, { projectPath, callId: crypto.randomUUID(), ...args })) as CallOutcome;
    } catch (e) {
      return { kind: "refused", message: String(e) };
    }
  }

  async function sendWrite(name: string, write: Write): Promise<WriteOutcome> {
    const outcome = await praxis(write.command, { ...write.args, requestId: unconfirmed.get(write.key) ?? null });
    if (outcome.kind === "unknown" && outcome.requestId) unconfirmed.set(write.key, outcome.requestId);
    else if (outcome.kind === "record" || outcome.kind === "hostRefused") unconfirmed.delete(write.key);
    await triggers.reread(name);
    return writeOutcomeOf(outcome, write);
  }

  function send(name: string, write: Write): Promise<WriteOutcome> {
    const joined = inFlight.get(write.key);
    if (joined) return joined;
    const sent = sendWrite(name, write).finally(() => inFlight.delete(write.key));
    inFlight.set(write.key, sent);
    return sent;
  }

  return {
    withdraw(name, revision) {
      const which = `revision ${revision} of ${name}`;
      return send(name, {
        command: "praxis_host_trigger_withdraw",
        args: { name, revision },
        key: `withdraw\n${name}\n${revision}`,
        doing: `withdraw ${which}`,
        done: `withdrew ${which}`,
      });
    },
    disable(name) {
      return send(name, { command: "praxis_host_trigger_disable", args: { name }, key: `disable\n${name}`, doing: `disable ${name}`, done: `disabled ${name}` });
    },
    retire(name) {
      return send(name, { command: "praxis_host_trigger_retire", args: { name }, key: `retire\n${name}`, doing: `retire ${name}`, done: `retired ${name}` });
    },
    async reviewPage(name, revision) {
      const outcome = await praxis("praxis_host_trigger_revision", { name, revision });
      if (outcome.kind !== "record") return { kind: "problem", message: outcomeMessage(outcome) };
      const address = outcome.record.admissionPageAddress;
      return typeof address === "string" ? { kind: "address", address } : { kind: "problem", message: "praxis gave no review page address." };
    },
  };
}

/** The controls the trigger form offers for graph trigger `name`. */
export interface TriggerControlActions {
  withdraw(revision: number): Promise<WriteOutcome>;
  disable(): Promise<WriteOutcome>;
  retire(): Promise<WriteOutcome>;
  reviewPage(revision: number): Promise<ReviewPage>;
}

/** `control` for graph trigger `name`, as its form uses it. */
export function bindTriggerControl(control: TriggerControl, name: string): TriggerControlActions {
  return {
    withdraw: (revision) => control.withdraw(name, revision),
    disable: () => control.disable(name),
    retire: () => control.retire(name),
    reviewPage: (revision) => control.reviewPage(name, revision),
  };
}
