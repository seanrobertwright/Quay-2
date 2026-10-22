// The tip calculator. test/tip.test.ts says what each function must do.

/** The tip on `bill` at `percent` percent, rounded to the nearest cent. */
export function calculateTip(bill: number, percent: number): number {
  throw new Error("not implemented");
}

/** The bill plus its tip at `percent` percent, rounded to the nearest cent. */
export function calculateTotal(bill: number, percent: number): number {
  throw new Error("not implemented");
}

/** Each person's share of `total` split `people` ways, rounded up to the cent so the bill is covered. */
export function splitBill(total: number, people: number): number {
  throw new Error("not implemented");
}
