/// <reference types="node" />
// Lets a component test load modules that are written for the bundler and that Node alone can't load:
// an import of another module of Quay's without its extension, an import of a type without the `type`
// keyword, and xterm, whose ES modules its package.json names only in a field that Node doesn't read.
// Imported before such a module, as `dom.ts` is. It imports `dom.ts` itself.
import { compiled } from "./dom.ts";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";

const SOURCE = new URL("../", import.meta.url).href;
const XTERM = /^@xterm\/([\w-]+)$/;

registerHooks({
  resolve(specifier, context, nextResolve) {
    const xterm = XTERM.exec(specifier);
    if (xterm) return nextResolve(`${specifier}/lib/${xterm[1]}.mjs`, context);
    if (specifier.startsWith(".") && context.parentURL?.startsWith(SOURCE)) {
      const bare = new URL(specifier, context.parentURL);
      const extension = [".ts", ".tsx"].find((ext) => !existsSync(bare) && existsSync(new URL(bare.href + ext)));
      if (extension) return nextResolve(specifier + extension, context);
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (!url.startsWith(SOURCE) || !/\.tsx?$/.test(url)) return nextLoad(url, context);
    // Without `verbatimModuleSyntax`, an import that is used only as a type is dropped.
    return compiled(url, { verbatimModuleSyntax: false });
  },
});

// xterm's add-ons read `self` as they load.
(globalThis as Record<string, unknown>).self ??= window;
