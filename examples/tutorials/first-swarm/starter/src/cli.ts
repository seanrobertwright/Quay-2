// Usage: node src/cli.ts <bill> <tip percent> [people]
// Prints the tip and the total, and each person's share when you give a number of people.

import { calculateTip, calculateTotal, splitBill } from "./tip.ts";

const [billArg, percentArg, peopleArg] = process.argv.slice(2);

function readNumber(name: string, value: string | undefined): number {
  const number = Number(value);
  if (value === undefined || value.trim() === "" || !Number.isFinite(number)) {
    console.error(`${name} must be a number, not ${JSON.stringify(value ?? "")}`);
    console.error("Usage: node src/cli.ts <bill> <tip percent> [people]");
    process.exit(1);
  }
  return number;
}

function dollars(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

const bill = readNumber("bill", billArg);
const percent = readNumber("tip percent", percentArg);
const tip = calculateTip(bill, percent);
const total = calculateTotal(bill, percent);
let line = `Tip: ${dollars(tip)}  Total: ${dollars(total)}`;
if (peopleArg !== undefined) {
  line += `  Each: ${dollars(splitBill(total, readNumber("people", peopleArg)))}`;
}
console.log(line);
