/**
 * Where a modal's focus trap sends Tab: from the last control to the first, with Shift from the
 * first to the last, and from outside the controls to the near end. Null leaves Tab to the browser.
 */
export function trapTabTarget<T>(controls: readonly T[], active: unknown, shift: boolean): T | null {
  if (controls.length === 0) return null;
  const first = controls[0];
  const last = controls[controls.length - 1];
  const inside = controls.includes(active as T);
  if (shift) return active === first || !inside ? last : null;
  return active === last || !inside ? first : null;
}
