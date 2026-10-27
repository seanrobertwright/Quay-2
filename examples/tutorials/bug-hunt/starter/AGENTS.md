# AGENTS.md

**Goal:** a cart-pricing library, `src/cart.ts`, and a receipt CLI, `src/cli.ts`.
`BUG-REPORT.md` lists three things users have seen go wrong.

## How the cart behaves

- Money is whole cents everywhere.
- Adding a SKU that is already in the cart raises that line's quantity.
- Removing a SKU that is not in the cart changes nothing.
- A percent coupon applies to the subtotal.
- The total never drops below zero.

## Commands

- `npm test` runs the tests in `test/` once.
- `npm run typecheck` type-checks the project.
- `npm run receipt -- carts/<file>.json` prints the receipt for a cart file.

## House rules

- Use npm, never yarn or pnpm. Add no dependencies.
- Write TypeScript that Node can run as it is: no `enum`, no `namespace`, no parameter
  properties.
- Keep every exported type and function signature in `src/cart.ts` as it is.
- Never change or delete an existing test.
