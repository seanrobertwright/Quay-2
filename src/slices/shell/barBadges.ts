/** A module icon's badge text: nothing at zero, the count up to 99, then "99+". */
export function badgeText(count: number): string | null {
  if (!(count > 0)) return null;
  return count > 99 ? "99+" : String(Math.floor(count));
}

/**
 * Today's spend as the 48 px bar's ticker shows it: cents below $100, whole dollars below
 * $1,000, then thousands. A missing or negative figure shows no amount.
 */
export function spendText(usd: number): string {
  if (!Number.isFinite(usd) || usd < 0) return "$–";
  if (usd < 99.995) return `$${usd.toFixed(2)}`;
  if (usd < 999.5) return `$${Math.round(usd)}`;
  const thousands = usd / 1000;
  return `$${thousands < 9.95 ? thousands.toFixed(1) : Math.round(thousands)}k`;
}
