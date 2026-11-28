/** Whether the focus is on `element` or inside it; false when there is no element. */
export function holdsFocus(element: Element | null): boolean {
  return element?.contains(document.activeElement) === true;
}
