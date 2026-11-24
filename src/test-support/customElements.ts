// Custom elements under `node --test`, for tests of what the A2UI engine does in the one it draws each
// component in: it carries what the component says in `@accessibility`. Imported before the A2UI module.
import "./dom.ts";

// The engine's own module reads the last three as it loads, where there are custom elements.
for (const key of ["customElements", "ShadowRoot", "Document", "CSSStyleSheet"]) {
  Object.defineProperty(globalThis, key, { value: (window as unknown as Record<string, unknown>)[key], configurable: true, writable: true });
}
