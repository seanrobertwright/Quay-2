/// <reference types="node" />
// Component tests under `node --test`. Importing this module installs a happy-dom window as the
// globals React renders into, a fake Tauri `invoke` (the out-of-process boundary), and a load
// hook that compiles `.tsx` with TypeScript, which Node's own type stripping doesn't handle.
// Static imports are all loaded before any module runs, so a test imports the components it
// renders with `await import(...)` after this module.
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { Window } from "happy-dom";

registerHooks({
  load(url, context, nextLoad) {
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
Object.assign(window, { __TAURI_INTERNALS__: { invoke: (cmd: string, args: Record<string, unknown>) => invokeImpl(cmd, args) } });

const globals = globalThis as Record<string, unknown>;
for (const key of ["document", "navigator", "HTMLElement", "Element", "Node", "Event", "KeyboardEvent", "MouseEvent", "getComputedStyle"]) {
  // Node's own `navigator` is a getter, so each global is defined rather than assigned.
  Object.defineProperty(globalThis, key, { value: (window as unknown as Record<string, unknown>)[key], configurable: true, writable: true });
}
globals.window = window;
// Tells React that updates are wrapped in `act`.
globals.IS_REACT_ACT_ENVIRONMENT = true;

/** Answers the components' Tauri `invoke` calls with `impl` until the next call. */
export function fakeInvoke(impl: Invoke): void {
  invokeImpl = impl;
}
