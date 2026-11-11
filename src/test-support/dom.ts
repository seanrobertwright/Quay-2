/// <reference types="node" />
// Component tests under `node --test`. Importing this module installs a happy-dom window as the
// globals React renders into, a fake Tauri `invoke` (the out-of-process boundary), stand-ins for
// Tauri's event listening, and a load hook that compiles `.tsx` with TypeScript, which Node's own type stripping doesn't handle,
// and loads a stylesheet a component imports as an empty module.
// Static imports are all loaded before any module runs, so a test imports the components it
// renders with `await import(...)` after this module.
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { Window } from "happy-dom";

registerHooks({
  load(url, context, nextLoad) {
    // A stylesheet a component imports, such as React Flow's, styles nothing a test reads.
    if (url.startsWith("file:") && url.endsWith(".css")) return { format: "module", source: "", shortCircuit: true };
    if (!url.startsWith("file:") || !url.endsWith(".tsx")) return nextLoad(url, context);
    const source = readFileSync(fileURLToPath(url), "utf8");
    const { outputText } = ts.transpileModule(source, {
      fileName: fileURLToPath(url),
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, verbatimModuleSyntax: true },
    });
    return { format: "module", source: outputText, shortCircuit: true };
  },
});

type Invoke = (cmd: string, args: Record<string, unknown>) => Promise<unknown>;

const window = new Window({ url: "http://localhost/" });
let invokeImpl: Invoke = (cmd) => Promise.reject(new Error(`no fake for ${cmd}`));
// A component's `listen` and its unlisten reach Tauri's event internals and the event plugin's
// commands as well as `invoke`. They get stand-ins that do nothing, so a test fakes only the
// commands its component calls, and no event is ever delivered.
const fakeEventCommands = new Map<string, unknown>([["plugin:event|listen", 1], ["plugin:event|unlisten", null]]);
Object.assign(window, {
  __TAURI_INTERNALS__: {
    invoke: (cmd: string, args: Record<string, unknown>) =>
      fakeEventCommands.has(cmd) ? Promise.resolve(fakeEventCommands.get(cmd)) : invokeImpl(cmd, args),
    transformCallback: () => 1,
  },
  __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => {} },
});

const globals = globalThis as Record<string, unknown>;
// React Flow, which draws the run canvas, observes its pane's size with a bare `ResizeObserver`.
for (const key of ["document", "navigator", "HTMLElement", "Element", "Node", "Event", "CustomEvent", "KeyboardEvent", "MouseEvent", "getComputedStyle", "ResizeObserver"]) {
  // Node's own `navigator` is a getter, so each global is defined rather than assigned.
  Object.defineProperty(globalThis, key, { value: (window as unknown as Record<string, unknown>)[key], configurable: true, writable: true });
}
for (const key of ["requestAnimationFrame", "cancelAnimationFrame"] as const) {
  // Called bare by components, so each is bound to the window it belongs to.
  globals[key] = window[key].bind(window);
}
for (const key of ["setTimeout", "clearTimeout"] as const) {
  // happy-dom keeps its own copy of Node's timers, so a component's `window.setTimeout` would
  // escape `mock.timers`. Each call goes to the global at call time instead.
  Object.assign(window, { [key]: (...args: unknown[]) => (globalThis[key] as (...a: unknown[]) => unknown)(...args) });
}
globals.window = window;
// Tells React that updates are wrapped in `act`.
globals.IS_REACT_ACT_ENVIRONMENT = true;

/** Answers the components' Tauri `invoke` calls, except event listening, with `impl` until the next call. */
export function fakeInvoke(impl: Invoke): void {
  invokeImpl = impl;
}
