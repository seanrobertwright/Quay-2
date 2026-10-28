# AGENTS.md

**Goal:** a notes app. A note has a title and a body. The first version of the API
covers listing, creating and deleting notes. Anything more is agreed between the agents.

## The contract

`shared/types.ts` holds the API contract: the types both sides import, and one comment line
per endpoint giving method, path, request body and status codes.

## Who owns what

- `backend-agent` owns `shared/types.ts` and `server/`.
- `frontend-agent` owns `web/`. It reads `shared/types.ts` but never edits it. It asks
  `backend-agent` for changes over the bus.
- Nobody edits `server/health.test.ts`.

## On the bus

- Answer a teammate's message in your reply.
- Never call `quay_send_message` back to a teammate who is waiting on you.

## Commands

- `npm test` runs the tests in `server/` once.
- `npm run typecheck` type-checks the whole project.
- `npm start` builds the UI into `dist/`, then serves it and the API on `http://localhost:3000`.
  Agents never run `npm start`; the user does.

## House rules

- Use npm, never yarn or pnpm. Add no dependencies, and never a native one: storage is `node:sqlite`.
- Write TypeScript that Node can run as it is: no `enum`, no `namespace`, no parameter properties,
  and imports that name the `.ts` file, as `import { createApp } from "./app.ts"`.
- Use relative `/api` URLs in `web/`.
- Don't run `npm start`. The user starts the app when both halves are done.
