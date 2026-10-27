// The receipt command: node src/cli/main.js samples/groceries.txt
import { readFileSync } from "node:fs";
import { run } from "./index.js";

process.exitCode = run(process.argv.slice(2), {
  readFile: (path) => readFileSync(path, "utf8"),
  out: (line) => console.log(line),
});
