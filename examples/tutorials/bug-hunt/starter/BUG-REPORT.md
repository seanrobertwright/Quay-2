# Bug report

Three things I've seen go wrong with the cart.

## 10% off three 20.00 mugs took 2.00 off, not 6.00

**What I did**

```text
npm run receipt -- carts/three-mugs.json
```

**What I saw**

```text
Mug x3             60.00
Discount           -2.00
Total              58.00
```

**What I expected**

A 10% coupon on 60.00 of mugs should take 6.00 off, for a total of 54.00.

## I added the same mug twice and the receipt lists it on two lines instead of x2

**What I did**

```text
npm run receipt -- carts/double-mug.json
```

**What I saw**

```text
Mug x1             20.00
Mug x1             20.00
Total              40.00
```

**What I expected**

One line, `Mug x2`, for 40.00.

## I mistyped a SKU when removing and my tote vanished

**What I did**

```text
npm run receipt -- carts/typo-remove.json
```

**What I saw**

```text
Mug x1             20.00
Total              20.00
```

**What I expected**

I typed `toet` instead of `tote`, so nothing should have been removed. The receipt should still
list the mug and the tote bag, for a total of 35.00.
