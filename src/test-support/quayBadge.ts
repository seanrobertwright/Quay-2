// How the component tests read the QUAY badge: where it is drawn, and which buttons it is drawn with.

/** Every QUAY badge in `root` that a screen reader reads. */
export const quayBadges = (root: Element): Element[] =>
  [...root.querySelectorAll("span")].filter((span) => span.textContent === "QUAY" && !span.closest('[aria-hidden="true"]'));

/** The names of the buttons in the smallest element around `badge` that holds any. */
export function buttonsAround(badge: Element): string[] {
  let around: Element | null = badge;
  while (around && around.querySelectorAll("button").length === 0) around = around.parentElement;
  return [...(around?.querySelectorAll("button") ?? [])].map(
    (button) => button.getAttribute("aria-label") ?? button.textContent?.trim() ?? "",
  );
}
