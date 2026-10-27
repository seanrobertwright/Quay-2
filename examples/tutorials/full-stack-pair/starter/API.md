# Bookmarks API

The contract `server/` implements and `web/` calls. The types are in `shared/api.ts`. Nobody
edits this file, `shared/api.ts` or `server/api.test.ts`.

Every body is JSON. Every URL is relative to the server, so the UI calls `/api/bookmarks`.

## Bookmark

```ts
type Bookmark = { id: number; title: string; url: string; createdAt: string };
type NewBookmark = { title: string; url: string };
type ApiError = { error: string };
```

- `id` is a whole number the server assigns. It is never reused.
- `createdAt` is when the bookmark was added, in UTC, as an ISO 8601 string.

## Endpoints

| Endpoint | Success | Errors |
| --- | --- | --- |
| `GET /api/health` | 200, `{ "ok": true }` | |
| `GET /api/bookmarks` | 200, `Bookmark[]`, newest first | |
| `POST /api/bookmarks` with a `NewBookmark` | 201, the created `Bookmark` | 400 |
| `DELETE /api/bookmarks/:id` | 204, no body | 404 |

- **Newest first** means the bookmark added last comes first: the highest `id` first.
- **400** when the body is not a JSON object, `title` is missing or empty after trimming spaces,
  or `url` is missing or does not start with `http://` or `https://`. The body is an `ApiError`.
- **404** when no bookmark has that `id`. The body is an `ApiError`.

## Storage

Bookmarks are stored in SQLite with `node:sqlite`, in the file `createApp(dbPath)` is given.
`npm start` uses `data/bookmarks.db`. The tests use `":memory:"`, so they never touch a file.
