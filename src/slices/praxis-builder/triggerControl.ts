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
import { outcomeMessage, type CallOutcome, type Invoker } from "./praxisHost.ts";
import type { TriggerHost } from "./triggerHost.ts";

/** What one control came to, in the words its confirm shows. */
export type ControlOutcome =
  | { kind: "done" }
  /** Nothing changed: the host refused it, or couldn't be asked. */
  | { kind: "refused"; message: string }
  /** Quay can't tell whether the host did it. */
  | { kind: "unknown"; message: string };

export interface TriggerControl {
  /** Withdraws pending candidate `revision` of `name` (`praxis triggers withdraw`), then rereads it. */
  withdraw(name: string, revision: number): Promise<ControlOutcome>;
  /**
   * Disables `name` (`praxis triggers disable`), then rereads it. praxis sends no revision, so the
   * host disables the trigger as it stands when the request lands.
   */
  disable(name: string): Promise<ControlOutcome>;
  /** Retires `name` (`praxis triggers retire`), then rereads it. Like disabling, it acts on the trigger as it stands. */
  retire(name: string): Promise<ControlOutcome>;
}

export interface TriggerControlOptions {
  projectPath: string;
  /** The trigger host model, which rereads a trigger after each write. */
  triggers: TriggerHost;
  call?: Invoker;
}

/** One kind of write and what it says, in the in-flight and unconfirmed key and in its outcome's words. */
interface Write {
  command: string;
  args: Record<string, unknown>;
  /** The write's key: its kind, the trigger and, for a withdrawal, the revision. */
  key: string;
  /** "withdraw revision 2 of nightly", as the outcome's words name it. */
  doing: string;
  /** "withdrew revision 2 of nightly". */
  done: string;
}

/** What a write's outcome means for the person who confirmed it. */
function outcomeOf(outcome: CallOutcome, write: Write): ControlOutcome {
  switch (outcome.kind) {
    case "record":
      return { kind: "done" };
    case "hostRefused":
      if (outcome.hostCode === "REVISION_NOT_PENDING") {
        return {
          kind: "refused",
          message: `The host refused to ${write.doing}: it is no longer pending. The owner has admitted or rejected it, or it was withdrawn already. ${outcome.message}`,
        };
      }
      return { kind: "refused", message: `The host refused to ${write.doing}: ${outcome.message}` };
    case "unknown":
      return {
        kind: "unknown",
        message: `Quay can't tell whether the host ${write.done}: ${outcome.detail}${outcome.requestId ? " Pressing it again resends the same request." : ""}`,
      };
    case "timedOut":
      return { kind: "unknown", message: `praxis didn't answer in time, so Quay can't tell whether the host ${write.done}.` };
    case "cancelled":
      return { kind: "unknown", message: `praxis was stopped before it said whether the host ${write.done}.` };
    default:
      return { kind: "refused", message: `Quay didn't ${write.doing}: ${outcomeMessage(outcome)}` };
  }
}

export function createTriggerControl({ projectPath, triggers, call = invoke }: TriggerControlOptions): TriggerControl {
  const inFlight = new Map<string, Promise<ControlOutcome>>();
  // The request id of each write praxis couldn't confirm, by its key, to resend.
  const unconfirmed = new Map<string, string>();

  async function praxis(command: string, args: Record<string, unknown>): Promise<CallOutcome> {
    try {
      return (await call(command, { projectPath, callId: crypto.randomUUID(), ...args })) as CallOutcome;
    } catch (e) {
      return { kind: "refused", message: String(e) };
    }
  }

  async function sendWrite(name: string, write: Write): Promise<ControlOutcome> {
    const outcome = await praxis(write.command, { ...write.args, requestId: unconfirmed.get(write.key) ?? null });
    if (outcome.kind === "unknown" && outcome.requestId) unconfirmed.set(write.key, outcome.requestId);
    else if (outcome.kind === "record" || outcome.kind === "hostRefused") unconfirmed.delete(write.key);
    await triggers.reread(name);
    return outcomeOf(outcome, write);
  }

  function send(name: string, write: Write): Promise<ControlOutcome> {
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
      return send(name, { command: "praxis_host_trigger_disable", args: { name }, key: `disable
${name}`, doing: `disable ${name}`, done: `disabled ${name}` });
    },
    retire(name) {
      return send(name, { command: "praxis_host_trigger_retire", args: { name }, key: `retire
${name}`, doing: `retire ${name}`, done: `retired ${name}` });
    },
  };
}

/** The controls the trigger form offers for graph trigger `name`. */
export interface TriggerControlActions {
  withdraw(revision: number): Promise<ControlOutcome>;
  disable(): Promise<ControlOutcome>;
  retire(): Promise<ControlOutcome>;
}

/** `control` for graph trigger `name`, as its form uses it. */
export function bindTriggerControl(control: TriggerControl, name: string): TriggerControlActions {
  return {
    withdraw: (revision) => control.withdraw(name, revision),
    disable: () => control.disable(name),
    retire: () => control.retire(name),
  };
}
