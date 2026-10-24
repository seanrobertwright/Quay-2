// A shopping cart, priced in whole cents. Every function returns a new cart and leaves the one it
// was given as it was.

export type Item = { sku: string; name: string; priceCents: number; quantity: number };
export type Coupon = { kind: "percent"; value: number } | { kind: "fixed"; valueCents: number };
export type Cart = { items: Item[]; coupon?: Coupon };

export function addItem(cart: Cart, item: Item): Cart {
  return { ...cart, items: [...cart.items, { ...item }] };
}

export function removeItem(cart: Cart, sku: string): Cart {
  const items = [...cart.items];
  const index = items.findIndex((line) => line.sku === sku);
  items.splice(index, 1);
  return { ...cart, items };
}

export function applyCoupon(cart: Cart, coupon: Coupon): Cart {
  return { ...cart, coupon };
}

/** The cart's price before any coupon, in cents. */
export function subtotal(cart: Cart): number {
  return cart.items.reduce((sum, line) => sum + line.priceCents * line.quantity, 0);
}

/** How much the coupon takes off, in cents. */
export function discount(cart: Cart): number {
  const coupon = cart.coupon;
  if (coupon === undefined) return 0;
  if (coupon.kind === "fixed") return coupon.valueCents;
  const priced = cart.items.reduce((sum, line) => sum + line.priceCents, 0);
  return Math.round((priced * coupon.value) / 100);
}

/** What the customer pays, in cents. */
export function total(cart: Cart): number {
  return Math.max(0, subtotal(cart) - discount(cart));
}

const WIDTH = 24;

function money(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const whole = Math.abs(cents);
  return `${sign}${Math.floor(whole / 100)}.${String(whole % 100).padStart(2, "0")}`;
}

function receiptLine(label: string, cents: number): string {
  const amount = money(cents);
  return `${label.padEnd(WIDTH - amount.length)}${amount}`;
}

/** One line per item, a Discount line when there is a coupon, then the Total line. */
export function formatReceipt(cart: Cart): string {
  const lines = cart.items.map((line) => receiptLine(`${line.name} x${line.quantity}`, line.priceCents * line.quantity));
  if (cart.coupon !== undefined) lines.push(receiptLine("Discount", -discount(cart)));
  lines.push(receiptLine("Total", total(cart)));
  return lines.join("\n");
}
