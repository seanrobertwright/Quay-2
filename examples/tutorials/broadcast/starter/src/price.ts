export type Currency = "USD" | "EUR";

/** Formats a whole number of cents as a price: `$19.99`, `-$2.50` or `19,99 €`. */
export function formatPrice(cents: number, currency: Currency): string {
  if (!Number.isInteger(cents)) {
    throw new RangeError(`cents must be a whole number, got ${cents}`);
  }
  const sign = cents < 0 ? "-" : "";
  const amount = Math.abs(cents);
  const whole = Math.floor(amount / 100);
  const part = String(amount % 100).padStart(2, "0");
  return currency === "USD" ? `${sign}$${whole}.${part}` : `${sign}${whole},${part} €`;
}
