/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkHost, isHostLevelFailure, openPraxisTerminal, praxisCall, type CallOutcome, type InteractiveCommand } from "./praxisHost.ts";

test("an interactive praxis command opens in a terminal in the project, as the backend spells it", async () => {
  const asked: InteractiveCommand[] = [];
  const opened: [string, string[]][] = [];
  const typed = await openPraxisTerminal(
    "login",
    "E:/work/app",
    async (cwd, argv) => {
      opened.push([cwd, argv]);
      return true;
    },
    async (command) => {
      asked.push(command);
      return ["node", "E:/sdk/engine/src/praxis.ts", command, "--state", "E:/praxis"];
    },
  );
  assert.equal(typed, true);
  assert.deepEqual(asked, ["login"]);
  assert.deepEqual(opened, [["E:/work/app", ["node", "E:/sdk/engine/src/praxis.ts", "login", "--state", "E:/praxis"]]]);
});

test("no terminal opens when praxis can't be found", async () => {
  let opened = false;
  await assert.rejects(
    openPraxisTerminal(
      "serve",
      "E:/work/app",
      async () => (opened = true),
      async () => {
        throw new Error("The praxis CLI isn't linked.");
      },
    ),
    /isn't linked/,
  );
  assert.equal(opened, false);
});

test("checking the host lists its templates for the project, and cancels that call when aborted", async () => {
  const calls: [string, Record<string, unknown>][] = [];
  let answer = (_: unknown) => {};
  const controller = new AbortController();
  const checking = checkHost("E:/work/app", controller.signal, (command, args) => {
    calls.push([command, args]);
    return command === "praxis_host_workflows_list" ? new Promise((resolve) => (answer = resolve)) : Promise.resolve(undefined);
  });
  const [listed, listArgs] = calls[0];
  assert.equal(listed, "praxis_host_workflows_list");
  assert.equal(listArgs.projectPath, "E:/work/app");
  controller.abort();
  assert.deepEqual(calls[1], ["praxis_host_cancel", { callId: listArgs.callId }]);
  answer({ kind: "cancelled" });
  await checking;
});

test("an aborted check sends no call at all", async () => {
  const controller = new AbortController();
  controller.abort();
  const calls: string[] = [];
  await checkHost("E:/work/app", controller.signal, async (command) => {
    calls.push(command);
  });
  assert.deepEqual(calls, []);
});

test("a check the backend can't make rejects with its reason, so the recheck can show it", async () => {
  await assert.rejects(
    checkHost("E:/work/app", new AbortController().signal, async () => {
      throw new Error("The project isn't registered.");
    }),
    /isn't registered/,
  );
});

test("only the outcomes that say the host itself can't be used are host-level failures", () => {
  const outcomes: CallOutcome[] = [
    { kind: "record", record: {} },
    { kind: "blocked", record: {}, blockingRunAddress: "r" },
    { kind: "needsUpdate", detail: "d" },
    { kind: "noHost", message: "m" },
    { kind: "hostDown", message: "m" },
    { kind: "notSignedIn", message: "m" },
    { kind: "expired", message: "m" },
    { kind: "refused", message: "m" },
    { kind: "cliNotFound", reason: "r" },
    { kind: "timedOut" },
    { kind: "cancelled" },
  ];
  assert.deepEqual(
    outcomes.filter(isHostLevelFailure).map((o) => o.kind),
    ["noHost", "hostDown", "notSignedIn", "expired", "cliNotFound"],
  );
});

test("a praxis call carries a fresh call id, and aborting it cancels that call", async () => {
  const sent: [string, Record<string, unknown>][] = [];
  let answer: (outcome: CallOutcome) => void = () => {};
  const call = (command: string, args: Record<string, unknown>) => {
    sent.push([command, args]);
    return command === "praxis_host_runs" ? new Promise<unknown>((resolve) => (answer = resolve)) : Promise.resolve(undefined);
  };
  const controller = new AbortController();
  const outcome = praxisCall("praxis_host_runs", { projectPath: "E:/app", name: "review-code", limit: 20 }, controller.signal, call);
  controller.abort();
  answer({ kind: "cancelled" });
  assert.deepEqual(await outcome, { kind: "cancelled" });
  const [[command, args], [cancel, cancelArgs]] = sent;
  assert.equal(command, "praxis_host_runs");
  assert.deepEqual({ ...args, callId: undefined }, { projectPath: "E:/app", name: "review-code", limit: 20, callId: undefined });
  assert.match(String(args.callId), /^[0-9a-f-]{36}$/);
  assert.equal(cancel, "praxis_host_cancel");
  assert.deepEqual(cancelArgs, { callId: args.callId });
});

test("an already aborted praxis call sends nothing", async () => {
  const sent: string[] = [];
  const controller = new AbortController();
  controller.abort();
  const outcome = await praxisCall("praxis_host_runs", {}, controller.signal, async (command) => void sent.push(command));
  assert.deepEqual(outcome, { kind: "cancelled" });
  assert.deepEqual(sent, []);
});

test("a praxis call the backend refuses comes back as a refusal in its words", async () => {
  const outcome = await praxisCall("praxis_host_runs", {}, new AbortController().signal, async () => {
    throw "The run limit must be from 1 to 100, not 0.";
  });
  assert.deepEqual(outcome, { kind: "refused", message: "The run limit must be from 1 to 100, not 0." });
});
