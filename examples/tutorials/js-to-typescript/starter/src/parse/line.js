// One line of a shopping list reads "<qty> x <name> @ <unit price>", as in "2 x Apples @ 0.40".
const ITEM = /^(?<qty>\d+)\s*x\s+(?<name>.+?)\s*@\s*(?<price>\d+(?:\.\d+)?)$/i;

/** Reads one shopping-list line into an item, or returns null when the line isn't one. */
export function parseLine(text) {
  const match = ITEM.exec(text.trim());
  if (match === null) return null;
  const qty = Number(match.groups.qty);
  if (qty < 1) return null;
  return { qty, name: match.groups.name, unitPrice: Number(match.groups.price) };
}
