# AGENTS.md

**Goal:** a bookmarks app. The API is specified in `API.md`, and its types are in
`shared/api.ts`. The UI lists bookmarks, adds one with a title and a URL, and deletes one.

## Commands

- `npm test` runs the contract tests in `server/api.test.ts` once.
- `npm run typecheck` type-checks the whole project.
- `npm start` builds the UI into `dist/`, then serves it and the API on
  `http://localhost:3000`.

## Who owns what

- `backend-agent` edits only `server/`, apart from `server/api.test.ts`.
- `frontend-agent` edits only `web/`.
- Nobody edits `shared/`, `API.md`, `server/api.test.ts` or `package.json`. They are the
  contract both halves build to. If the contract seems wrong, say so instead of changing it.

## House rules

- The contract tests are the backend's definition of done: keep going until `npm test` passes,
  and never change a test to make it pass.
- Use npm, never yarn or pnpm. Add no dependencies, and never a native one: storage is
  `node:sqlite`.
- Write TypeScript that Node can run as it is: no `enum`, no `namespace`, no parameter
  properties, and imports that name the `.ts` file, as `import { createApp } from "./app.ts"`.
- Don't run `npm start`. The user starts the app when both halves are done.
