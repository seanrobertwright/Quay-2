// node src/cli.ts <cart.json>: replays a cart file's operations in order and prints the receipt.
// A cart file is a list of operations: { "add": <item> }, { "remove": "<sku>" } or { "coupon": <coupon> }.
import { readFileSync } from "node:fs";
import { addItem, applyCoupon, formatReceipt, removeItem, type Cart, type Coupon, type Item } from "./cart.ts";

type Operation = { kind: "add"; item: Item } | { kind: "remove"; sku: string } | { kind: "coupon"; coupon: Coupon };

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isWholeNumber(value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): boolean {
  return Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max;
}

function isItem(value: unknown): value is Item {
  if (!isRecord(value)) return false;
  const { sku, name, priceCents, quantity } = value;
  return typeof sku === "string" && sku !== "" && typeof name === "string" && isWholeNumber(priceCents, 0) && isWholeNumber(quantity, 1);
}

function isCoupon(value: unknown): value is Coupon {
  if (!isRecord(value)) return false;
  if (value.kind === "percent") return isWholeNumber(value.value, 0, 100);
  return value.kind === "fixed" && isWholeNumber(value.valueCents, 0);
}

function parseOperation(value: unknown, index: number): Operation {
  if (isRecord(value)) {
    if (Object.hasOwn(value, "add") && isItem(value.add)) return { kind: "add", item: value.add };
    if (Object.hasOwn(value, "remove") && typeof value.remove === "string") return { kind: "remove", sku: value.remove };
    if (Object.hasOwn(value, "coupon") && isCoupon(value.coupon)) return { kind: "coupon", coupon: value.coupon };
  }
  return fail(
    `operation ${index + 1} must be { "add": <item> }, { "remove": "<sku>" } or { "coupon": <coupon> }, ` +
      `where an item has a sku, a name, a whole priceCents and a quantity of at least 1, ` +
      `and a coupon is { "kind": "percent", "value": 0 to 100 } or { "kind": "fixed", "valueCents": <whole cents> }`,
  );
}

function replay(operations: Operation[]): Cart {
  let cart: Cart = { items: [] };
  for (const operation of operations) {
    if (operation.kind === "add") cart = addItem(cart, operation.item);
    else if (operation.kind === "remove") cart = removeItem(cart, operation.sku);
    else cart = applyCoupon(cart, operation.coupon);
  }
  return cart;
}

const file = process.argv[2];
if (file === undefined) fail("Usage: node src/cli.ts <cart.json>");
const list: unknown = JSON.parse(readFileSync(file, "utf8"));
if (!Array.isArray(list)) fail(`${file} must hold a list of operations`);
console.log(formatReceipt(replay(list.map(parseOperation))));
