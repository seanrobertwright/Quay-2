/** The inset under `label` in a Quay card, a box of its own with that accessible name. */
export const inset = (root: Element, label: string): HTMLElement | undefined =>
  [...root.querySelectorAll<HTMLElement>('[role="group"]')].find(
    (box) => document.getElementById(box.getAttribute("aria-labelledby") ?? "")?.textContent === label,
  );
