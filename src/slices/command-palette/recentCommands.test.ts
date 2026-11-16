// The palette's most recent commands, which the pie's Palette slices copy: newest first, each
// command once, three kept, and stored so they survive a restart.
import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_RECENT_COMMANDS, recentCommands } from "./recentCommands.ts";

function memoryStorage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  return { getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => void items.set(k, v), items };
}

test("the commands the palette ran, newest first, each once, three kept", () => {
  assert.equal(MAX_RECENT_COMMANDS, 3);
  const store = recentCommands(memoryStorage());
  assert.deepEqual(store.read(), []);
  store.ran({ id: "a", title: "A" });
  store.ran({ id: "b", title: "B" });
  store.ran({ id: "c", title: "C" });
  assert.deepEqual(store.ran({ id: "a", title: "A again" }), [
    { id: "a", title: "A again" },
    { id: "c", title: "C" },
    { id: "b", title: "B" },
  ]);
  store.ran({ id: "d", title: "D" });
  assert.deepEqual(
    store.read().map((c) => c.id),
    ["d", "a", "c"]
  );
});

test("they survive a restart, and a stored value that is not a list of commands reads as none", () => {
  const storage = memoryStorage();
  recentCommands(storage).ran({ id: "layout-grid", title: "2x2 Quad Grid Layout" });
  assert.deepEqual(recentCommands(storage).read(), [{ id: "layout-grid", title: "2x2 Quad Grid Layout" }]);
  for (const raw of ["not json", "{}", '[{"id":""}]', '[{"id":3,"title":"x"}]', "null"]) {
    const [key] = [...storage.items.keys()];
    assert.deepEqual(recentCommands(memoryStorage({ [key]: raw })).read(), [], raw);
  }
});
