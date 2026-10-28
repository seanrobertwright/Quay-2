import { readFileSync } from "node:fs";
import { formatPrice, type Currency } from "./price.ts";

const usage = "Usage: node src/cli.ts <cents> [USD|EUR]\n       node src/cli.ts --version";
const [first, second = "USD"] = process.argv.slice(2);

if (first === "--version") {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
  console.log(pkg.version);
} else if (first === undefined || !/^-?\d+$/.test(first) || (second !== "USD" && second !== "EUR")) {
  console.error(usage);
  process.exitCode = 1;
} else {
  console.log(formatPrice(Number(first), second satisfies Currency));
}
