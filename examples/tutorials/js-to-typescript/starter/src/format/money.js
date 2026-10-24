/** An amount of money with two decimals: formatMoney(0.4) is "0.40". */
export function formatMoney(amount) {
  return amount.toFixed(2);
}

/** Whole cents, so sums of prices don't pick up floating-point dust. */
export function toCents(amount) {
  return Math.round(amount * 100);
}

/** Pads text with spaces on the left to at least width characters. */
export function padLeft(text, width) {
  return text.padStart(width);
}
