import { describe, expect, it } from "vitest";
import { type Contact, findDuplicates } from "../src/dedupe.ts";

function contact(id: string, email: string, phone: string): Contact {
  return { id, name: `Contact ${id}`, email, phone };
}

describe("findDuplicates", () => {
  it("gives no groups for an empty list", () => {
    expect(findDuplicates([])).toEqual([]);
  });

  it("gives no groups when nobody matches", () => {
    const contacts = [
      contact("a", "ada@example.com", "555-010-1000"),
      contact("b", "grace@example.com", "555-010-2000"),
      contact("c", "alan@example.com", "555-010-3000"),
    ];
    expect(findDuplicates(contacts)).toEqual([]);
  });

  it("matches emails after trimming and lower-casing", () => {
    const contacts = [
      contact("a", "Ada@Example.com ", "555-010-1000"),
      contact("b", "grace@example.com", "555-010-2000"),
      contact("c", "ada@example.com", "555-010-3000"),
    ];
    expect(findDuplicates(contacts)).toEqual([["a", "c"]]);
  });

  it("matches phones on their digits alone", () => {
    const contacts = [
      contact("a", "ada@example.com", "(555) 010-2000"),
      contact("b", "grace@example.com", "555.010.2000"),
    ];
    expect(findDuplicates(contacts)).toEqual([["a", "b"]]);
  });

  it("joins matches transitively, with ids in input order and groups by their first member", () => {
    const contacts = [
      contact("x", "alan@example.com", "555-010-9000"),
      contact("c", "carol@example.com", "555 010 3000"),
      contact("y", "", "555.010.9000"),
      contact("a", "ada@example.com", "555-010-1000"),
      contact("b", "ADA@example.com", "5550103000"),
    ];
    expect(findDuplicates(contacts)).toEqual([
      ["x", "y"],
      ["c", "a", "b"],
    ]);
  });

  it("never matches on an empty email or phone", () => {
    const contacts = [
      contact("a", "", ""),
      contact("b", "", ""),
      contact("c", " ", "--"),
    ];
    expect(findDuplicates(contacts)).toEqual([]);
  });
});
