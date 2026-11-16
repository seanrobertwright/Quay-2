// Unit tests for the shell preferences (#647): the Quay · every project group's settings, kept per
// machine, validated on load, and each one a `Preferences: …` palette command.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readShellPrefs, writeShellPref, preferenceCommands } from "./shellPrefs.ts";
import { memoryStorage } from "../companion/fixtures/companionFixtures.ts";

test("with nothing stored every setting reads its default", () => {
  assert.deepEqual(readShellPrefs(memoryStorage()), {
    piePalette: "spectrum",
    pieLabelOutline: true,
    pieDisplayDelayMs: 150,
    mergeUndoSeconds: 5,
    companionOpensOn: "pull-request",
    soundChime: true,
  });
});

test("a value set is read back by a later read of the same storage, as after a restart", () => {
  const storage = memoryStorage();
  writeShellPref(storage, "piePalette", "sunset");
  writeShellPref(storage, "pieLabelOutline", false);
  writeShellPref(storage, "pieDisplayDelayMs", 0);
  writeShellPref(storage, "mergeUndoSeconds", 0);
  writeShellPref(storage, "companionOpensOn", "activity");
  writeShellPref(storage, "soundChime", false);
  assert.deepEqual(readShellPrefs(storage), {
    piePalette: "sunset",
    pieLabelOutline: false,
    pieDisplayDelayMs: 0,
    mergeUndoSeconds: 0,
    companionOpensOn: "activity",
    soundChime: false,
  });
});

test("a bad stored value reads as that setting's default and leaves the others alone", () => {
  const prefs = readShellPrefs(
    memoryStorage({
      quay_pie_palette: "toString",
      quay_pie_label_outline: "yes",
      quay_pie_display_delay_ms: "200",
      quay_merge_undo_seconds: "NaN",
      quay_companion_opens_on: "repository",
      quay_chime_enabled: "",
    })
  );
  assert.deepEqual(prefs, {
    piePalette: "spectrum",
    pieLabelOutline: true,
    pieDisplayDelayMs: 150,
    mergeUndoSeconds: 5,
    companionOpensOn: "pull-request",
    soundChime: true,
  });
  assert.equal(readShellPrefs(memoryStorage({ quay_merge_undo_seconds: "10", quay_pie_display_delay_ms: " 300" })).mergeUndoSeconds, 10);
  assert.equal(readShellPrefs(memoryStorage({ quay_pie_display_delay_ms: " 300" })).pieDisplayDelayMs, 150);
});

test("the companion and the chime read the values the Project panel stores", async () => {
  const { companionPrefs } = await import("../companion/companionPrefs.ts");
  const storage = memoryStorage();
  writeShellPref(storage, "companionOpensOn", "ticket");
  assert.equal(companionPrefs(storage).readOpensOn(), "ticket");
  writeShellPref(storage, "soundChime", false);
  assert.equal(storage.data.get("quay_chime_enabled"), "false");
});

test("every choice is a Preferences palette command per value, and every toggle one command that flips it", () => {
  const prefs = readShellPrefs(memoryStorage({ quay_chime_enabled: "false" }));
  const commands = preferenceCommands(prefs);
  assert.deepEqual(
    commands.map((c) => [c.title, c.current]),
    [
      ["Preferences: Pie palette: Spectrum", true],
      ["Preferences: Pie palette: Cyan + magenta", false],
      ["Preferences: Pie palette: Cyan + orange", false],
      ["Preferences: Pie palette: Lime + cyan", false],
      ["Preferences: Pie palette: Pink + yellow", false],
      ["Preferences: Pie palette: Ice white + green", false],
      ["Preferences: Pie label outline: Turn off", false],
      ["Preferences: Pie display delay: None", false],
      ["Preferences: Pie display delay: 150 ms", true],
      ["Preferences: Pie display delay: 300 ms", false],
      ["Preferences: Merge undo window: Off", false],
      ["Preferences: Merge undo window: 3 s", false],
      ["Preferences: Merge undo window: 5 s", true],
      ["Preferences: Merge undo window: 10 s", false],
      ["Preferences: Companion opens on: Pull request", true],
      ["Preferences: Companion opens on: Ticket", false],
      ["Preferences: Companion opens on: Activity", false],
      ["Preferences: Sound chime: Turn on", false],
    ]
  );
  assert.equal(new Set(commands.map((c) => c.id)).size, commands.length, "ids are unique");
});

test("running a Preferences command stores its value", () => {
  const storage = memoryStorage();
  const set = (title: string) => {
    const command = preferenceCommands(readShellPrefs(storage)).find((c) => c.title === title);
    assert.ok(command, title);
    writeShellPref(storage, command.key, command.value);
  };
  set("Preferences: Merge undo window: 10 s");
  set("Preferences: Pie label outline: Turn off");
  assert.equal(readShellPrefs(storage).mergeUndoSeconds, 10);
  assert.equal(readShellPrefs(storage).pieLabelOutline, false);
  set("Preferences: Pie label outline: Turn on");
  assert.equal(readShellPrefs(storage).pieLabelOutline, true);
});
