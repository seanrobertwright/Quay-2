import { describe, expect, it } from "vitest";
import { addItem, applyCoupon, discount, formatReceipt, removeItem, subtotal, total, type Cart, type Item } from "../src/cart.ts";

const mug: Item = { sku: "mug", name: "Mug", priceCents: 2000, quantity: 1 };
const tote: Item = { sku: "tote", name: "Tote bag", priceCents: 1500, quantity: 1 };
const empty: Cart = { items: [] };

describe("addItem", () => {
  it("adds an item to an empty cart", () => {
    expect(addItem(empty, mug).items).toEqual([mug]);
  });

  it("adds two different SKUs as two lines", () => {
    const cart = addItem(addItem(empty, mug), tote);
    expect(cart.items).toEqual([mug, tote]);
    expect(subtotal(cart)).toBe(3500);
  });
});

describe("removeItem", () => {
  it("removes the line with the given SKU", () => {
    const cart = addItem(addItem(empty, mug), tote);
    expect(removeItem(cart, "mug").items).toEqual([tote]);
  });
});

describe("applyCoupon", () => {
  it("takes 10% off one item", () => {
    const cart = applyCoupon(addItem(empty, mug), { kind: "percent", value: 10 });
    expect(discount(cart)).toBe(200);
    expect(total(cart)).toBe(1800);
  });

  it("takes a fixed amount off", () => {
    const cart = applyCoupon(addItem(empty, mug), { kind: "fixed", valueCents: 500 });
    expect(total(cart)).toBe(1500);
  });
});

describe("total", () => {
  it("never drops below zero", () => {
    const cart = applyCoupon(addItem(empty, tote), { kind: "fixed", valueCents: 5000 });
    expect(total(cart)).toBe(0);
  });
});

describe("formatReceipt", () => {
  it("prints one line per item, then the Total line", () => {
    const lines = formatReceipt(addItem(addItem(empty, mug), tote)).split("\n");
    expect(lines).toEqual([
      "Mug x1             20.00",
      "Tote bag x1        15.00",
      "Total              35.00",
    ]);
  });
});
