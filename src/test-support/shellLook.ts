/// <reference types="node" />
// The shell look in component tests: the stylesheet that draws the live parts in the accent, put
// in the test document, and the pie palette's accent set on the document root as the app sets it.
// Tailwind's classes are not compiled under `node --test`, so only this stylesheet's colours show
// in a computed style. Import after `dom.ts`.
import { readFileSync } from "node:fs";
import type { PiePaletteId } from "../slices/pie/piePalettes.ts";
import { applyShellAccent } from "../slices/shell/shellAccent.ts";

const STYLESHEET = readFileSync(new URL("../slices/shell/shellLook.css", import.meta.url), "utf8");

/** Puts the shell look stylesheet in the document, once, and sets `palette`'s accent on the root. */
export function installShellLook(palette: PiePaletteId): void {
  if (!document.querySelector("style[data-shell-look]")) {
    const style = document.createElement("style");
    style.dataset.shellLook = "";
    style.textContent = STYLESHEET;
    document.head.append(style);
  }
  applyShellAccent(document.documentElement, palette);
}
