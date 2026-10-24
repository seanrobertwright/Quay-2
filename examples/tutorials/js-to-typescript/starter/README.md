# receipt

A command-line tool that reads a shopping list and prints a receipt with a total. Each line of
the list reads `<qty> x <name> @ <unit price>`; blank lines and lines starting with `#` are
skipped.

```text
> node src/cli/main.js samples/groceries.txt
2 x Apples @ 0.40      0.80
1 x Bread @ 2.25       2.25
3 x Milk @ 1.10        3.30
---------------------------
TOTAL                  6.35
```

Add `--total` to print only the `TOTAL` line.

It is written in plain JavaScript, in three folders: `src/parse/` reads the list, `src/format/`
prints the receipt and `src/cli/` runs the command. The goal is to convert it to TypeScript with
no change in behaviour. The tests in `test/` are TypeScript already and stay as they are.
`AGENTS.md` has the rules.

It needs Node 24 or later, which runs TypeScript as it is, so once the code is converted the
command is `node src/cli/main.ts samples/groceries.txt`.
