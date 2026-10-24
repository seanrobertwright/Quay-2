// Usage: node src/cli.ts <bill> <tip percent> [people]
// Prints the tip and the total, and each person's share when you give a number of people.

import { calculateTip, calculateTotal, splitBill } from "./tip.ts";

const USAGE = "Usage: node src/cli.ts <bill> <tip percent> [people]";
const [billArg, percentArg, peopleArg] = process.argv.slice(2);

function fail(message: string): never {
  console.error(message);
  console.error(USAGE);
  process.exit(1);
}

/** Reads an argument as a number that is zero or more, or a whole number of one or more. */
function readNumber(name: string, value: string | undefined, kind: "amount" | "count"): number {
  const number = Number(value);
  if (value === undefined || value.trim() === "" || !Number.isFinite(number)) {
    fail(`${name} must be a number, not ${JSON.stringify(value ?? "")}`);
  }
  if (kind === "amount" && number < 0) fail(`${name} can't be negative, but it is ${value}`);
  if (kind === "count" && (!Number.isInteger(number) || number < 1)) fail(`${name} must be a whole number of 1 or more, not ${value}`);
  return number;
}

function dollars(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

const bill = readNumber("bill", billArg, "amount");
const percent = readNumber("tip percent", percentArg, "amount");
const people = peopleArg === undefined ? null : readNumber("people", peopleArg, "count");
const tip = calculateTip(bill, percent);
const total = calculateTotal(bill, percent);
let line = `Tip: ${dollars(tip)}  Total: ${dollars(total)}`;
if (people !== null) line += `  Each: ${dollars(splitBill(total, people))}`;
console.log(line);
