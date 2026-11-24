// Keys for a list whose items have no id of their own.

/** `items`, each with a key of its own: its text, and how many before it have the same. */
export function keyed<T>(items: readonly T[], textOf: (item: T) => string): { key: string; item: T }[] {
  const seen = new Map<string, number>();
  return items.map((item) => {
    const text = textOf(item);
    const before = seen.get(text) ?? 0;
    seen.set(text, before + 1);
    return { key: JSON.stringify([text, before]), item };
  });
}
