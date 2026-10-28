# Notes

A small web app for taking notes. The API in `server/` stores notes in SQLite, and the
React UI in `web/` lists them, adds one and deletes one. `shared/types.ts` is the API contract
between the two halves, owned by `backend-agent` and negotiated over the A2A bus.

```text
npm test            run tests
npm run typecheck   type-check the project
npm start           build the UI and serve everything on http://localhost:3000
```

Only `GET /api/health` is written so far, and the UI is a placeholder heading. It needs Node 24 or later,
which runs TypeScript as it is.
