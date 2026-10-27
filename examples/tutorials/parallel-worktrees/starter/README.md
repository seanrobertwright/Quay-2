# Contacts de-duplicator

`findDuplicates(contacts)` in `src/dedupe.ts` finds the contacts in an address book that are the
same person, and it isn't written yet.

## The rule

- Two contacts are the same person when their emails match after trimming and lower-casing, or
  their phones match once everything but the digits is dropped.
- It is transitive: when A matches B and B matches C, all three are one person.
- An empty email or phone never matches anything.
- `findDuplicates` returns each group of two or more contacts as a list of ids, with the ids in
  input order and the groups ordered by their first member. A contact nobody matches is in no
  group.

`test/dedupe.test.ts` holds the tests it must pass. Run them with `npm test`.

## The bar

The team's address books hold 50,000 contacts, so `findDuplicates` has to handle 50,000 in under
500 ms. `npm run compare` measures that:

```text
npm run compare -- <branch> ...
```

For each branch it uses the folder that branch is checked out in: the project folder for `main`,
or `.worktrees/<branch>` for a git worktree made in Quay. In that folder it runs the tests once,
times `findDuplicates` on 50,000 generated contacts that hold exactly 2,500 duplicate groups,
giving up after five seconds, and counts the lines changed under `src/` since `main`. With no
branch named, it measures `main`.

It needs Node 24 or later, which runs TypeScript as it is.
