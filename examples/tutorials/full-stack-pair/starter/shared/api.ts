// The types API.md describes, shared by server/ and web/. Nobody edits this file.

/** A saved bookmark, as every endpoint returns it. */
export type Bookmark = {
  id: number;
  title: string;
  url: string;
  /** When it was added, in UTC, as an ISO 8601 string such as "2026-10-24T09:30:00.000Z". */
  createdAt: string;
};

/** The body of POST /api/bookmarks. */
export type NewBookmark = {
  title: string;
  url: string;
};

/** The body of every 400 and 404 response. */
export type ApiError = {
  error: string;
};
