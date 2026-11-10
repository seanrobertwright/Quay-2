/// <reference types="node" />
import "../../test-support/dom.ts";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  HOST_ONLY_LIMIT,
  hostBadge,
  hostGroupHeader,
  hostImportAvailability,
  hostOnlyDetails,
  hostOnlySection,
  rowBadges,
} from "./hostList.ts";
import type { HostOnlyTemplate, ImportHostTemplateOutcome, TemplateHostView } from "./hostCatalog.ts";

const { HostOnlySubsection } = await import("./HostList.tsx");

const NOW = 1_800_000_000_000;
const view = (state: TemplateHostView["state"], checkedAt: number | null = NOW, muted = false): TemplateHostView => ({
  state,
  checkedAt,
  muted,
  checking: false,
});

test("a row's badges are the git badge first and the host badge second", () => {
  const badges = rowBadges("triage", "modified", view({ kind: "differs" }), NOW);
  assert.deepEqual(
    badges.map((b) => b.kind),
    ["git", "host"],
  );
});

test("a row with no change since the last commit has only its host badge", () => {
  assert.deepEqual(
    rowBadges("triage", undefined, view({ kind: "installed" }), NOW).map((b) => b.kind),
    ["host"],
  );
});

test("a row whose host state is unknown because of the host has only its git badge", () => {
  assert.deepEqual(
    rowBadges("triage", "added", view({ kind: "unknown", why: "host" }, null), NOW).map((b) => b.kind),
    ["git"],
  );
});

test("every host badge has a text equivalent that names the template and its state", () => {
  const text = (state: TemplateHostView["state"]) => hostBadge("triage", view(state), NOW)?.text;
  assert.equal(text({ kind: "nameRefused", rule: "lowercase" }), "triage on the host: Name the host refuses");
  assert.equal(text({ kind: "notInstalled" }), "triage on the host: Not installed");
  assert.equal(text({ kind: "invalidOnHost", diagnostics: [] }), "triage on the host: Invalid on host");
  assert.equal(text({ kind: "differs" }), "triage on the host: Differs from host");
  assert.equal(text({ kind: "notReady", reason: "No runner." }), "triage on the host: Installed, not ready");
  assert.equal(text({ kind: "installed" }), "triage on the host: Installed");
});

test("states that need attention are coloured, and Installed is a muted check", () => {
  const tone = (state: TemplateHostView["state"]) => hostBadge("triage", view(state), NOW)?.tone;
  assert.equal(tone({ kind: "nameRefused", rule: "lowercase" }), "error");
  assert.equal(tone({ kind: "invalidOnHost", diagnostics: [] }), "error");
  assert.equal(tone({ kind: "notInstalled" }), "attention");
  assert.equal(tone({ kind: "differs" }), "attention");
  assert.equal(tone({ kind: "notReady", reason: "No runner." }), "attention");
  assert.equal(tone({ kind: "installed" }), "muted");
});

test("a badge's tooltip carries the host's reason", () => {
  assert.match(hostBadge("triage", view({ kind: "notReady", reason: "No runner is set up." }), NOW)?.title ?? "", /No runner is set up\./);
  assert.match(hostBadge("triage", view({ kind: "invalidOnHost", diagnostics: ["Bad step."] }), NOW)?.title ?? "", /Bad step\./);
  assert.match(hostBadge("Triage", view({ kind: "nameRefused", rule: "Use lowercase." }), NOW)?.title ?? "", /Use lowercase\./);
});

test("a read that failed shows a neutral badge with why, not a host state", () => {
  const badge = hostBadge("triage", view({ kind: "unknown", why: "failed", message: "praxis didn't answer in time." }), NOW);
  assert.equal(badge?.tone, "neutral");
  assert.equal(badge?.text, "triage on the host: Couldn't check");
  assert.match(badge?.title ?? "", /praxis didn't answer in time\./);
});

test("a template not checked yet has no host badge", () => {
  assert.equal(hostBadge("triage", view({ kind: "unknown", why: "notChecked" }, null), NOW), null);
});

test("a muted reading says it may be out of date, in its tooltip and its text", () => {
  const badge = hostBadge("triage", view({ kind: "installed" }, NOW - 12 * 60_000, true), NOW);
  assert.equal(badge?.muted, true);
  assert.equal(badge?.title, "Installed. May be out of date: checked 12 min ago.");
  assert.equal(badge?.text, "triage on the host: Installed, may be out of date");
});

test("a current reading doesn't say it may be out of date", () => {
  const badge = hostBadge("triage", view({ kind: "differs" }, NOW - 60_000), NOW);
  assert.equal(badge?.muted, false);
  assert.doesNotMatch(badge?.title ?? "", /out of date/);
});

test("the group header shows the host-level condition and always offers Check host", () => {
  for (const condition of [{ state: "notCheckedYet" }, { state: "signedIn" }, { state: "hostUnreachable" }] as const) {
    const header = hostGroupHeader(condition);
    assert.equal(header.checkHostLabel, "Check host");
  }
  assert.equal(hostGroupHeader({ state: "notCheckedYet" }).condition, "Host not checked yet");
  assert.equal(hostGroupHeader({ state: "hostUnreachable" }).condition, "Host down");
});

test("Not signed in adds Sign in, the host chip's action", () => {
  const header = hostGroupHeader({ state: "notSignedIn" });
  assert.equal(header.condition, "Not signed in");
  assert.deepEqual(header.action, { command: "login", label: "Sign in" });
  assert.equal(header.linkCli, null);
});

test("praxis CLI not found says how to link it, with the reason", () => {
  const header = hostGroupHeader({ state: "cliNotFound", reason: "No praxis on PATH." });
  assert.equal(header.condition, "praxis CLI not found");
  assert.match(header.linkCli?.text ?? "", /npm link/);
  assert.equal(header.linkCli?.reason, "No praxis on PATH.");
  assert.equal(header.action, null);
});

test("Host down and No host set up add no action to the header: only Not signed in does", () => {
  assert.equal(hostGroupHeader({ state: "hostUnreachable" }).action, null);
  assert.equal(hostGroupHeader({ state: "noHostSetUp" }).action, null);
});

test("a signed-in host offers no action besides Check host", () => {
  const header = hostGroupHeader({ state: "signedIn" });
  assert.equal(header.action, null);
  assert.equal(header.linkCli, null);
});

const hostOnly = (name: string, valid = true, more: Partial<HostOnlyTemplate> = {}): HostOnlyTemplate => ({
  name,
  revision: 3,
  description: null,
  valid,
  diagnostics: [],
  ...more,
});

test("the On host only subsection appears only when the latest reading found host-only templates", () => {
  assert.equal(hostOnlySection([]), null);
  assert.equal(hostOnlySection([hostOnly("review"), hostOnly("deploy")])?.title, "On host only (2)");
});

test("On host only rows are by name, with the invalid badge from list", () => {
  const section = hostOnlySection([hostOnly("review"), hostOnly("deploy", false, { diagnostics: ["Unknown step kind."] })]);
  assert.deepEqual(
    section?.rows.map((r) => [r.name, r.invalid?.state ?? null]),
    [
      ["deploy", "invalidOnHost"],
      ["review", null],
    ],
  );
  assert.equal(section?.rows[0]?.invalid?.text, "deploy is invalid on the host");
  assert.equal(section?.rows[0]?.invalid?.tone, "error");
});

test("the On host only subsection draws at most HOST_ONLY_LIMIT rows and counts the rest", () => {
  const total = HOST_ONLY_LIMIT + 5;
  const templates = Array.from({ length: total }, (_, i) => hostOnly(`t-${String(total - i).padStart(4, "0")}`));
  const section = hostOnlySection(templates);
  assert.equal(section?.title, `On host only (${total})`);
  assert.equal(section?.rows.length, HOST_ONLY_LIMIT);
  assert.equal(section?.omitted, 5);
  assert.equal(section?.rows[0]?.name, "t-0001");
});

test("a short On host only list omits nothing", () => {
  assert.equal(hostOnlySection([hostOnly("review")])?.omitted, 0);
});

test("a host-only template's read-only panel has its description, revision and validity", () => {
  assert.deepEqual(hostOnlyDetails(hostOnly("deploy", false, { description: "Ships it.", diagnostics: ["Unknown step kind."] })), [
    { label: "Description", value: "Ships it." },
    { label: "Revision", value: "3" },
    { label: "Validity", value: "Invalid. Unknown step kind." },
  ]);
  assert.deepEqual(hostOnlyDetails(hostOnly("review", true, { revision: null })), [
    { label: "Description", value: "None given" },
    { label: "Revision", value: "Not given" },
    { label: "Validity", value: "Valid" },
  ]);
});

test("valid host-only templates allow import", () => {
  const availability = hostImportAvailability(hostOnly("deploy", true));
  assert.equal(availability.allowed, true);
  assert.equal(availability.diagnostic, null);
});

test("invalid host-only templates flag import as disabled with diagnostics", () => {
  const availability = hostImportAvailability(hostOnly("deploy", false, { diagnostics: ["Unknown step kind.", "Missing runner."] }));
  assert.equal(availability.allowed, false);
  assert.equal(availability.diagnostic, "Unknown step kind. Missing runner.");
});

test("invalid host-only templates without diagnostics give a fallback diagnostic", () => {
  const availability = hostImportAvailability(hostOnly("deploy", false, { diagnostics: [] }));
  assert.equal(availability.allowed, false);
  assert.equal(availability.diagnostic, "The template is invalid on the host.");
});

let mounted: { root: Root; container: HTMLElement } | null = null;

afterEach(() => {
  if (mounted) {
    const { root, container } = mounted;
    act(() => root.unmount());
    container.remove();
    mounted = null;
  }
});

async function renderComponent(element: ReactElement): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted = { root, container };
  await act(async () => root.render(element));
  return container;
}

const click = (el: HTMLElement | null | undefined) => act(async () => el?.click());

test("expanded panel renders 'Import to project' button enabled for valid templates", async () => {
  const section = hostOnlySection([hostOnly("deploy", true)])!;
  const root = await renderComponent(createElement(HostOnlySubsection, { section }));

  // Expand subsection
  const expandBtn = root.querySelector("button[aria-expanded='false']") as HTMLButtonElement;
  await click(expandBtn);

  // Expand row
  const rowBtn = Array.from(root.querySelectorAll("li button")).find((b) => b.textContent?.trim() === "deploy") as HTMLButtonElement;
  await click(rowBtn);

  // Check Import to project button
  const buttons = Array.from(root.querySelectorAll("button"));
  const importBtn = buttons.find((b) => b.textContent?.includes("Import to project")) as HTMLButtonElement;
  assert.ok(importBtn, "Import to project button should be rendered");
  assert.equal(importBtn.disabled, false);
});

test("expanded panel renders disabled 'Import to project' button with diagnostic message when template is invalid", async () => {
  const section = hostOnlySection([hostOnly("broken", false, { diagnostics: ["Invalid step syntax."] })])!;
  const root = await renderComponent(createElement(HostOnlySubsection, { section }));

  // Expand subsection
  const expandBtn = root.querySelector("button[aria-expanded='false']") as HTMLButtonElement;
  await click(expandBtn);

  // Expand row
  const rowBtn = Array.from(root.querySelectorAll("li button")).find((b) => b.textContent?.trim() === "broken") as HTMLButtonElement;
  await click(rowBtn);

  // Check Import to project button is disabled
  const buttons = Array.from(root.querySelectorAll("button"));
  const importBtn = buttons.find((b) => b.textContent?.includes("Import to project")) as HTMLButtonElement;
  assert.ok(importBtn, "Import to project button should be rendered");
  assert.equal(importBtn.disabled, true);
  assert.equal(importBtn.title, "Invalid step syntax.");

  // Check explanatory diagnostic message
  assert.match(root.textContent ?? "", /Invalid step syntax\./);
});

test("clicking 'Import to project' enters in-progress loading state, triggers callback, and disables duplicate clicks", async () => {
  let resolveImport!: (outcome: ImportHostTemplateOutcome) => void;
  const pendingPromise = new Promise<ImportHostTemplateOutcome>((resolve) => {
    resolveImport = resolve;
  });
  const calls: string[] = [];
  const onImport = (name: string) => {
    calls.push(name);
    return pendingPromise;
  };

  const section = hostOnlySection([hostOnly("deploy", true)])!;
  const root = await renderComponent(createElement(HostOnlySubsection, { section, onImport }));

  // Expand subsection and row
  await click(root.querySelector("button[aria-expanded='false']") as HTMLButtonElement);
  const rowBtn = Array.from(root.querySelectorAll("li button")).find((b) => b.textContent?.trim() === "deploy") as HTMLButtonElement;
  await click(rowBtn);

  const importBtn = Array.from(root.querySelectorAll("button")).find((b) => b.textContent?.includes("Import to project")) as HTMLButtonElement;
  assert.ok(importBtn);

  // Click import
  await click(importBtn);

  // Verify callback was called
  assert.deepEqual(calls, ["deploy"]);

  // Verify loading state
  assert.match(importBtn.textContent ?? "", /Importing…/);
  assert.equal(importBtn.disabled, true);
  const spinner = importBtn.querySelector(".animate-spin");
  assert.ok(spinner, "Spinner with animate-spin should be present during import");

  // Attempt duplicate click while in progress
  await click(importBtn);
  assert.deepEqual(calls, ["deploy"], "Duplicate click must not trigger additional onImport calls");

  // Resolve import
  await act(async () => {
    resolveImport({
      ok: true,
      kind: "imported",
      name: "deploy",
      filePath: ".praxis/templates/deploy.json",
      templateDigest: "abc",
      hostDigest: "abc",
      digestMatches: true,
    });
  });
});

test("displays inline error banner inside the panel when import fails", async () => {
  const onImport = async (name: string): Promise<ImportHostTemplateOutcome> => {
    return {
      ok: false,
      kind: "refused",
      message: `The template "${name}" already exists or could not be saved.`,
    };
  };

  const section = hostOnlySection([hostOnly("deploy", true)])!;
  const root = await renderComponent(createElement(HostOnlySubsection, { section, onImport }));

  // Expand subsection and row
  await click(root.querySelector("button[aria-expanded='false']") as HTMLButtonElement);
  const rowBtn = Array.from(root.querySelectorAll("li button")).find((b) => b.textContent?.trim() === "deploy") as HTMLButtonElement;
  await click(rowBtn);

  const importBtn = Array.from(root.querySelectorAll("button")).find((b) => b.textContent?.includes("Import to project")) as HTMLButtonElement;
  await click(importBtn);

  // Check inline error banner
  const alert = root.querySelector("[role='alert']");
  assert.ok(alert, "An alert role element should be displayed on import failure");
  assert.match(alert.textContent ?? "", /The template "deploy" already exists or could not be saved\./);
});

