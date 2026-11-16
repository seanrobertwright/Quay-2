// Reading a list kept as JSON in localStorage, validated item by item as it is read.

/**
 * The items of the JSON list `raw` that pass `isItem`, in stored order. Nothing stored, a value
 * that is not JSON or a JSON value that is not a list all read as an empty list.
 */
export function parseStoredList<T>(raw: string | null, isItem: (value: unknown) => value is T): T[] {
  if (raw === null) return [];
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return [];
  }
  return Array.isArray(value) ? value.filter(isItem) : [];
}
