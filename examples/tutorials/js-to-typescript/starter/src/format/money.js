/** An amount of money with two decimals: formatMoney(0.4) is "0.40". */
export function formatMoney(amount) {
  return amount.toFixed(2);
}

/** Whole cents, so sums of prices don't pick up floating-point dust. */
export function toCents(amount) {
  return Math.round(amount * 100);
}

/** An amount of money right-aligned in a column width characters wide. */
export function moneyColumn(amount, width) {
  return formatMoney(amount).padStart(width);
}
