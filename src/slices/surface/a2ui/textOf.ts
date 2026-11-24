/** What a property that holds text reads: a binding may resolve to data of any kind, of which an object or a list is no text. */
export const textOf = (value: unknown): string => {
  if (typeof value === "string") return value;
  return typeof value === "number" || typeof value === "boolean" ? String(value) : "";
};
