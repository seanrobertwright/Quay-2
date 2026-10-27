import { greet, isLang } from "./greet.ts";

const [name, lang = "en"] = process.argv.slice(2);

if (!name || !isLang(lang)) {
  console.error("Usage: node src/cli.ts <name> [en|es|fr]");
  process.exit(1);
}

console.log(greet(name, lang));
