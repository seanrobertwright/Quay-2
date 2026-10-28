# Changelog

## 2.0.0

- `slugify` lowercases and strips accents by default: `"Crème Brûlée"` becomes `creme-brulee`.
  1.x kept capitals and accents.
- `slugify`'s `maxLength` cuts between words, never inside one: `slugify("The quick brown fox",
  { maxLength: 12 })` is `the-quick`. Only a first word longer than `maxLength` on its own is cut.
- `truncate` counts the ellipsis inside its limit: `truncate("Hello world", 8)` is `Hello w…`,
  eight characters. In 1.x the ellipsis came on top of the limit.
- Added `uniqueSlug(text, taken)`, which appends `-2`, then `-3` and so on until the slug is
  not in `taken`.
- Needs Node 24 or later.

## 1.2.0

- `slugify` takes a `separator` option.

## 1.1.0

- Added `truncate(text, max)`.

## 1.0.0

- First release: `slugify(text)`.
