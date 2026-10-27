# AGENTS.md

**Goal:** a notes app for two users, alice and bob, that keeps every rule below through every
route.

## The rules of the app

1. No route shows a user anything but their own notes and notes marked shared. The pages show
   both; the API's list, `GET /api/notes`, shows only your own.
2. Only a note's owner can delete it. A note you can't delete is a 404, not a 403.
3. A note's title and body are shown exactly as typed, as text. They never run and never change
   the page around them.
4. Search matches titles of your own notes only, and any text is a valid search.

The login is a stand-in for a real one: `GET /login/alice` and `GET /login/bob` set the `user`
cookie, and whoever sends that cookie is that user. Trusting the cookie is part of the app's
design, not a hole.

## Commands

- `npm test` runs the tests once.
- `npm run typecheck` type-checks the project.
- `npm start` runs the server on port 3000. It reads `.env`, so copy `.env.example` to `.env`
  first.

## Who edits what

- `red-team` edits only `test/exploits/`.
- `blue-team` edits only `server/` and `.gitignore`.
- Nobody edits `test/notes.test.ts`, `AGENTS.md`, `package.json` or `.env`, and nobody deletes
  `.env`: the server needs it.

## Exploit tests

- One file per hole in `test/exploits/`, calling the app in-process through
  `createApp(":memory:")` and `app.request()`, as `test/notes.test.ts` does.
- An exploit test asserts one of the rules above, so it is red while the hole is open and green
  once it's closed. A green exploit test means the exploit failed.

## House rules

- Use npm, never yarn or pnpm. Add no dependencies, and never a native one.
- Write TypeScript that Node can run as it is: no `enum`, no `namespace`, no parameter
  properties.
- Keep the `createApp(dbPath)` signature: the tests build the app with it.
