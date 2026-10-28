/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ariaKeyShortcuts,
  commandFor,
  focusRegion,
  KEY_ENTRIES,
  shortcutLabel,
  type FocusRegion,
  type KeyLike,
} from "./keymap.ts";

const key = (k: string, mods: Partial<KeyLike> = {}): KeyLike => ({
  key: k,
  code: "",
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ...mods,
});
const ctrl = (k: string, mods: Partial<KeyLike> = {}) => key(k, { ctrlKey: true, ...mods });
const cmd = (k: string, mods: Partial<KeyLike> = {}) => key(k, { metaKey: true, ...mods });

const ALL_REGIONS: FocusRegion[] = ["text", "canvas", "other"];
const route = (e: KeyLike, region: FocusRegion, mac = false) => commandFor(e, region, mac);

test("Mod is Ctrl on Windows and Linux and Cmd on macOS", () => {
  assert.equal(route(ctrl("z"), "other"), "undo");
  assert.equal(route(cmd("z"), "other"), null);
  assert.equal(route(cmd("z"), "other", true), "undo");
  assert.equal(route(ctrl("z"), "other", true), null);
});

test("Mod+S and Escape work in every region, text fields included", () => {
  for (const region of ALL_REGIONS) {
    assert.equal(route(ctrl("s"), region), "save");
    assert.equal(route(key("Escape"), region), "escape");
  }
});

test("in a text field everything else goes to the field, native undo included", () => {
  for (const e of [ctrl("z"), ctrl("y"), ctrl("z", { shiftKey: true }), ctrl("c"), ctrl("x"), ctrl("v"), ctrl("d"), key("Delete"), key("Backspace"), ctrl("a"), key("?", { shiftKey: true }), ctrl("0")]) {
    assert.equal(route(e, "text"), null, `${e.key} in a text field`);
  }
});

test("undo and redo work outside text fields, on Mod+Shift+Z or Mod+Y for redo", () => {
  for (const region of ["canvas", "other"] as const) {
    assert.equal(route(ctrl("z"), region), "undo");
    assert.equal(route(ctrl("Z", { shiftKey: true }), region), "redo");
    assert.equal(route(ctrl("y"), region), "redo");
  }
});

test("canvas keys need focus in the canvas", () => {
  const canvasKeys: [KeyLike, string][] = [
    [ctrl("c"), "copy"],
    [ctrl("x"), "cut"],
    [ctrl("v"), "paste"],
    [ctrl("d"), "duplicate"],
    [key("Delete"), "delete"],
    [key("Backspace"), "delete"],
    [ctrl("a"), "select-all"],
    [key("!", { shiftKey: true, code: "Digit1" }), "fit-view"],
    [ctrl("="), "zoom-in"],
    [ctrl("+", { shiftKey: true }), "zoom-in"],
    [ctrl("-"), "zoom-out"],
    [ctrl("0"), "zoom-reset"],
    [key("?", { shiftKey: true }), "help"],
    [key("A", { shiftKey: true }), "auto-arrange"],
  ];
  for (const [e, command] of canvasKeys) {
    assert.equal(route(e, "canvas"), command, `${e.key} in the canvas`);
    assert.equal(route(e, "other"), null, `${e.key} outside the canvas`);
  }
});

test("the builder never takes Quay's own keys", () => {
  for (const region of ALL_REGIONS) {
    assert.equal(route(ctrl("b"), region), null);
    assert.equal(route(ctrl("B", { shiftKey: true }), region), null);
    assert.equal(route(ctrl("k"), region), null);
    assert.equal(route(cmd("k"), region, true), null);
    for (let d = 1; d <= 9; d++) assert.equal(route(key(String(d), { altKey: true }), region), null);
  }
});

test("extra modifiers don't match: AltGr, Ctrl with Cmd, and Shift where it isn't asked for", () => {
  assert.equal(route(ctrl("z", { altKey: true }), "canvas"), null);
  assert.equal(route(ctrl("z", { metaKey: true }), "canvas"), null);
  assert.equal(route(ctrl("s", { shiftKey: true }), "canvas"), null);
  assert.equal(route(key("Delete", { shiftKey: true }), "canvas"), null);
  assert.equal(route(key("1"), "canvas"), null, "a plain 1 isn't Shift+1");
  assert.equal(route(key("a"), "canvas"), null, "a plain A isn't Shift+A");
  assert.equal(route(key("A", { shiftKey: true, altKey: true }), "canvas"), null);
});

test("each command appears in the table once, with at least one chord", () => {
  const commands = KEY_ENTRIES.map((e) => e.command);
  assert.equal(new Set(commands).size, commands.length);
  for (const entry of KEY_ENTRIES) assert.ok(entry.chords.length > 0, entry.command);
});

test("hints and aria-keyshortcuts come from the same table", () => {
  assert.equal(shortcutLabel("save", false), "Ctrl+S");
  assert.equal(shortcutLabel("save", true), "Cmd+S");
  assert.equal(shortcutLabel("redo", false), "Ctrl+Shift+Z");
  assert.equal(shortcutLabel("fit-view", false), "Shift+1");
  assert.equal(shortcutLabel("help", false), "?");
  assert.equal(shortcutLabel("auto-arrange", false), "Shift+A");
  assert.equal(ariaKeyShortcuts("redo", false), "Control+Shift+Z Control+Y");
  assert.equal(ariaKeyShortcuts("undo", true), "Meta+Z");
});

// Duck-typed targets, as ctrlBPrefix's tests use.
const el = (tagName: string, extra: Record<string, unknown> = {}) => ({ tagName, ...extra }) as unknown as EventTarget;

test("the focus region is text for typed-into fields, canvas inside the canvas, other elsewhere", () => {
  const canvasChild = el("div");
  const canvas = { contains: (t: unknown) => t === canvasChild };
  assert.equal(focusRegion(el("input", { type: "text" }), canvas), "text");
  assert.equal(focusRegion(el("textarea"), canvas), "text");
  assert.equal(focusRegion(el("input", { type: "checkbox" }), canvas), "other");
  assert.equal(focusRegion(el("button"), canvas), "other");
  assert.equal(focusRegion(canvasChild, canvas), "canvas");
  assert.equal(focusRegion(canvasChild, null), "other");
});
