import { formatMoney, padLeft, toCents } from "./money.js";

const MONEY_WIDTH = 8;

/**
 * The receipt for a list of items: one row per item with its quantity, unit price and line
 * total, a rule, then a TOTAL line. The money column lines up on the right.
 */
export function renderReceipt(items) {
  const rows = [];
  let totalCents = 0;
  for (const item of items) {
    const cents = toCents(item.qty * item.unitPrice);
    rows.push({ label: `${item.qty} x ${item.name} @ ${formatMoney(item.unitPrice)}`, cents });
    totalCents += cents;
  }
  const width = Math.max(0, ...rows.map((row) => row.label.length)) + 2;
  const lines = rows.map((row) => line(row.label, row.cents, width));
  lines.push("-".repeat(width + MONEY_WIDTH));
  lines.push(line("TOTAL", totalCents, width));
  return lines.join("\n");
}

function line(label, cents, width) {
  return label.padEnd(width) + padLeft(formatMoney(cents / 100), MONEY_WIDTH);
}
