// node src/cli.ts <cart.json>: replays a cart file's operations in order and prints the receipt.
// A cart file is a list of operations: { "add": <item> }, { "remove": "<sku>" } or { "coupon": <coupon> }.
import { readFileSync } from "node:fs";
import { addItem, applyCoupon, formatReceipt, removeItem, type Cart, type Coupon, type Item } from "./cart.ts";

type Operation = { kind: "add"; item: Item } | { kind: "remove"; sku: string } | { kind: "coupon"; coupon: Coupon };

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function parseOperation(value: unknown, index: number): Operation {
  if (typeof value === "object" && value !== null) {
    const fields = value as Record<string, unknown>;
    if (Object.hasOwn(fields, "add")) return { kind: "add", item: fields.add as Item };
    if (Object.hasOwn(fields, "remove") && typeof fields.remove === "string") return { kind: "remove", sku: fields.remove };
    if (Object.hasOwn(fields, "coupon")) return { kind: "coupon", coupon: fields.coupon as Coupon };
  }
  return fail(`operation ${index + 1} must be { "add": ... }, { "remove": "<sku>" } or { "coupon": ... }`);
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
