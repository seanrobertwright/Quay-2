# Tip calculator

A command-line tip calculator. Give it a bill and a tip percentage, and optionally how many
people are paying:

```text
node src/cli.ts <bill> <tip percent> [people]
```

```text
> node src/cli.ts 42.50 18 3
Tip: $7.65  Total: $50.15  Each: $16.72
```

`src/tip.ts` does the arithmetic, and its functions aren't written yet:

- `calculateTip(bill, percent)` is the tip, rounded to the nearest cent. A negative bill throws
  a `RangeError`.
- `calculateTotal(bill, percent)` is the bill plus the tip, rounded to the nearest cent.
- `splitBill(total, people)` is each person's share, rounded up to the cent so the bill is
  covered.

`test/tip.test.ts` holds the tests they must pass. Run them with `npm test`.

It needs Node 24 or later, which runs TypeScript as it is.
