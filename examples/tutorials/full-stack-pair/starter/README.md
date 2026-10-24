# Bookmarks

A small web app for saving links. The API in `server/` stores bookmarks in SQLite, and the
React UI in `web/` lists them, adds one and deletes one. `API.md` is the contract between the
two halves, `shared/api.ts` holds its types, and `server/api.test.ts` holds the contract tests
the API must pass.

```text
npm test            the contract tests
npm run typecheck   type-check the project
npm start           build the UI and serve everything on http://localhost:3000
```

Only `GET /api/health` is written so far, and the UI is a heading. It needs Node 24 or later,
which runs TypeScript as it is.
