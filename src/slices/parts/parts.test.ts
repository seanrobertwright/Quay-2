/// <reference types="node" />
// Component tests for the plain parts Quay's cards are drawn from (#712): native controls, each
// with a programmatic label, that hand every change to the component that holds the state.
import "../../test-support/dom.ts";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement, Fragment, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

const { Button } = await import("./Button.tsx");
const { OptionRow } = await import("./OptionRow.tsx");
const { TextField } = await import("./TextField.tsx");

let mounted: { root: Root; container: HTMLElement } | null = null;
afterEach(() => {
  if (!mounted) return;
  act(() => mounted?.root.unmount());
  mounted.container.remove();
  mounted = null;
});

function render(node: ReactNode): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounted = { root, container };
  act(() => root.render(node));
  return container;
}

test("a button names its action, submits no form, and acts on a click unless disabled", () => {
  const clicked: string[] = [];
  const container = render(
    createElement(
      Fragment,
      null,
      createElement(Button, { onClick: () => void clicked.push("send"), children: "Send" }),
      createElement(Button, { onClick: () => void clicked.push("held"), disabled: true, children: "Held" }),
    ),
  );
  const [send, held] = [...container.querySelectorAll("button")];
  assert.equal(send.textContent, "Send");
  assert.equal(send.type, "button");
  act(() => send.click());
  act(() => held.click());
  assert.deepEqual(clicked, ["send"]);
});

/** Types `text` into a field as the operator would, so React hears it. */
function type(field: HTMLInputElement | HTMLTextAreaElement, text: string): void {
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), "value")!.set!.call(field, text);
  act(() => void field.dispatchEvent(new Event("input", { bubbles: true })));
}

test("a text field is labelled, shows its value and hands over what is typed", () => {
  const typed: string[] = [];
  const container = render(createElement(TextField, { label: "Comment", value: "why", onChange: (text: string) => void typed.push(text) }));
  const field = container.querySelector("input")!;
  const label = container.querySelector("label");
  assert.equal(label?.textContent, "Comment");
  assert.ok(field.id !== "" && label?.htmlFor === field.id, "the label names the field");
  assert.equal(field.value, "why");
  type(field, "because");
  assert.deepEqual(typed, ["because"]);
});

test("a text field with rows takes several lines, and two fields share no id", () => {
  const typed: string[] = [];
  const container = render(
    createElement(
      Fragment,
      null,
      createElement(TextField, { label: "Comment", value: "", rows: 3, onChange: (text: string) => void typed.push(text) }),
      createElement(TextField, { label: "Comment", value: "", disabled: true, onChange: () => {} }),
    ),
  );
  const several = container.querySelector("textarea")!;
  assert.equal(several.getAttribute("rows"), "3");
  type(several, "one\ntwo");
  assert.deepEqual(typed, ["one\ntwo"]);
  const one = container.querySelector("input")!;
  assert.ok(one.disabled);
  assert.notEqual(one.id, several.id);
});

test("a text field's note describes it, and an empty one keeps its line and describes nothing", () => {
  const field = (note?: string) => createElement(TextField, { label: "Comment", value: "", note, onChange: () => {} });
  const container = render(createElement(Fragment, null, field("Say why."), field(""), field()));
  const described = [...container.querySelectorAll("input")].map((input) => document.getElementById(input.getAttribute("aria-describedby") ?? "")?.textContent ?? null);
  assert.deepEqual(described, ["Say why.", null, null]);
  assert.deepEqual([...container.querySelectorAll("p")].map((line) => line.textContent), ["Say why.", ""]);
});

test("option rows that share a group are native radios named by their label and described by their description", () => {
  const picked: [string, boolean][] = [];
  const container = render(
    createElement(
      Fragment,
      null,
      createElement(OptionRow, {
        kind: "radio", group: "base", label: "Rebase", description: "onto master", checked: false, onChange: (checked: boolean) => void picked.push(["Rebase", checked]),
      }),
      createElement(OptionRow, { kind: "radio", group: "base", label: "Merge", checked: true, onChange: () => {} }),
    ),
  );
  const [rebase, merge] = [...container.querySelectorAll("input")];
  assert.deepEqual([rebase.type, merge.type], ["radio", "radio"]);
  assert.deepEqual([rebase.name, merge.name], ["base", "base"], "the arrow keys move between them");
  assert.equal(container.querySelector(`label[for="${rebase.id}"]`)?.textContent, "Rebase");
  assert.equal(document.getElementById(rebase.getAttribute("aria-describedby") ?? "")?.textContent, "onto master");
  assert.ok(!merge.hasAttribute("aria-describedby"), "nothing describes an option with no description");
  assert.deepEqual([rebase.checked, merge.checked], [false, true]);
  act(() => rebase.click());
  assert.deepEqual(picked, [["Rebase", true]]);
});

test("an option row's mark is beside its label and described with it", () => {
  const container = render(
    createElement(OptionRow, { kind: "radio", group: "base", label: "Rebase", description: "onto master", mark: "agent's pick", checked: false, onChange: () => {} }),
  );
  const input = container.querySelector("input")!;
  assert.equal(container.querySelector("label")?.textContent, "Rebase", "the mark is no part of the option's name");
  const described = (input.getAttribute("aria-describedby") ?? "").split(" ").map((id) => document.getElementById(id)?.textContent);
  assert.deepEqual(described, ["agent's pick", "onto master"]);
});

test("an option row of several is a native checkbox that can be ticked and unticked", () => {
  const changes: boolean[] = [];
  const row = (checked: boolean) =>
    createElement(OptionRow, { kind: "checkbox", group: "steps", label: "Step 4", checked, onChange: (now: boolean) => void changes.push(now) });
  const container = render(createElement(Fragment, null, row(false), row(true)));
  const [off, on] = [...container.querySelectorAll("input")];
  assert.equal(off.type, "checkbox");
  act(() => off.click());
  act(() => on.click());
  assert.deepEqual(changes, [true, false]);
});
