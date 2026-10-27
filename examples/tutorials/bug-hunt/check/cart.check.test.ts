// The check suite: tests the agents never saw. Unzip it into the project so check/ sits beside
// src/, then run it with npx vitest run check.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { addItem, applyCoupon, discount, removeItem, type Cart, type Item } from "../src/cart.ts";

const mug: Item = { sku: "mug", name: "Mug", priceCents: 2000, quantity: 1 };
const tote: Item = { sku: "tote", name: "Tote bag", priceCents: 1500, quantity: 1 };
const empty: Cart = { items: [] };

function receiptFor(cartFile: string): string[] {
  const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
  const cart = fileURLToPath(new URL(`../carts/${cartFile}`, import.meta.url));
  return execFileSync(process.execPath, [cli, cart], { encoding: "utf8" }).trimEnd().split(/\r?\n/);
}

describe("a percent coupon", () => {
  it("takes 10% off every unit of a line", () => {
    const cart = applyCoupon(addItem(empty, { ...mug, quantity: 3 }), { kind: "percent", value: 10 });
    expect(discount(cart)).toBe(600);
  });

  it("still takes 10% off a single unit", () => {
    const cart = applyCoupon(addItem(empty, mug), { kind: "percent", value: 10 });
    expect(discount(cart)).toBe(200);
  });

  it("brings three-mugs.json to a total of 54.00", () => {
    expect(receiptFor("three-mugs.json").at(-1)).toMatch(/^Total\s+54\.00$/);
  });
});

describe("adding a SKU already in the cart", () => {
  it("raises that line's quantity instead of adding a line", () => {
    const cart = addItem(addItem(empty, mug), mug);
    expect(cart.items).toEqual([{ ...mug, quantity: 2 }]);
  });
});

describe("removing a SKU", () => {
  it("leaves the cart unchanged when the SKU is not in it", () => {
    const cart = addItem(addItem(empty, mug), tote);
    expect(removeItem(cart, "toet")).toEqual(cart);
  });

  it("still removes only that line when the SKU is in it", () => {
    const cart = addItem(addItem(empty, mug), tote);
    expect(removeItem(cart, "tote").items).toEqual([mug]);
  });
});
