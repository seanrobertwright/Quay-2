// node scripts/bench.ts <folder>: times findDuplicates from <folder>/src/dedupe.ts on the 50,000
// contacts and prints {"ms": <time>, "groups": <group count>} as one line of JSON.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Contact } from "../src/dedupe.ts";
import { makeContacts } from "./contacts.ts";

const folder = process.argv[2];
if (folder === undefined) {
  console.error("usage: node scripts/bench.ts <folder>");
  process.exit(2);
}

const dedupe: { findDuplicates: (contacts: Contact[]) => string[][] } = await import(
  pathToFileURL(resolve(folder, "src", "dedupe.ts")).href
);
const contacts = makeContacts();
const start = performance.now();
const groups = dedupe.findDuplicates(contacts);
const ms = performance.now() - start;
console.log(JSON.stringify({ ms: Math.round(ms), groups: groups.length }));
