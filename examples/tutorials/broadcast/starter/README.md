# pricetag

A tiny price-formatting library with a command line. `formatPrice(cents, currency)` turns a
whole number of cents into a price: `$19.99`, `-$2.50` or `19,99 €`.

```sh
node src/cli.ts 1999        # $19.99
node src/cli.ts 1999 EUR    # 19,99 €
node src/cli.ts --version   # the version in package.json
```

`npm test` runs the price tests and the release tests, which check that `package.json` and
`CHANGELOG.md` agree.
