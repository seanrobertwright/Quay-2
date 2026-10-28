// Prints the statistics for the file named on the command line. Finished: the work is in stats.ts.
import { readFileSync } from "node:fs";
import { countLines, countWords, topWord } from "./stats.ts";

const file = process.argv[2];
if (file === undefined) {
  console.error("Usage: node src/cli.ts <file>");
  process.exit(2);
}

const text = readFileSync(file, "utf8");
const top = topWord(text);
console.log(`Lines: ${countLines(text)}  Words: ${countWords(text)}  Top word: ${top.word} (${top.count})`);
