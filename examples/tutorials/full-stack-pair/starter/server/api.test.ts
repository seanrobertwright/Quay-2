// The contract tests: what API.md promises, checked in-process against an in-memory database.
// Nobody edits this file. The API is done when every test passes.
import { describe, expect, test } from "vitest";
import type { ApiError, Bookmark, NewBookmark } from "../shared/api.ts";
import { createApp } from "./app.ts";

function post(app: ReturnType<typeof createApp>, body: NewBookmark) {
  return app.request("/api/bookmarks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("the bookmarks API", () => {
  test("GET /api/health returns 200", async () => {
    const res = await createApp(":memory:").request("/api/health");
    expect(res.status).toBe(200);
  });

  test("GET /api/bookmarks returns an empty list at first", async () => {
    const res = await createApp(":memory:").request("/api/bookmarks");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  test("POST /api/bookmarks returns 201 with the created bookmark", async () => {
    const res = await post(createApp(":memory:"), { title: "Quay", url: "https://example.com/quay" });
    expect(res.status).toBe(201);
    const created = (await res.json()) as Bookmark;
    expect(created).toMatchObject({ title: "Quay", url: "https://example.com/quay" });
    expect(Number.isInteger(created.id)).toBe(true);
    expect(created.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
  });

  test("POST /api/bookmarks with an empty title returns 400", async () => {
    const res = await post(createApp(":memory:"), { title: "  ", url: "https://example.com" });
    expect(res.status).toBe(400);
    expect(typeof ((await res.json()) as ApiError).error).toBe("string");
  });

  test("POST /api/bookmarks with a URL that is not http or https returns 400", async () => {
    const res = await post(createApp(":memory:"), { title: "Files", url: "ftp://example.com" });
    expect(res.status).toBe(400);
    expect(typeof ((await res.json()) as ApiError).error).toBe("string");
  });

  test("GET /api/bookmarks after two POSTs returns both, newest first", async () => {
    const app = createApp(":memory:");
    await post(app, { title: "First", url: "https://example.com/1" });
    await post(app, { title: "Second", url: "http://example.com/2" });
    const res = await app.request("/api/bookmarks");
    expect(res.status).toBe(200);
    const titles = ((await res.json()) as Bookmark[]).map((bookmark) => bookmark.title);
    expect(titles).toEqual(["Second", "First"]);
  });

  test("DELETE /api/bookmarks/:id returns 204 and the bookmark is gone", async () => {
    const app = createApp(":memory:");
    const created = (await (await post(app, { title: "Gone soon", url: "https://example.com" })).json()) as Bookmark;
    const res = await app.request(`/api/bookmarks/${created.id}`, { method: "DELETE" });
    expect(res.status).toBe(204);
    expect(await (await app.request("/api/bookmarks")).json()).toEqual([]);
  });

  test("DELETE /api/bookmarks/:id for an unknown id returns 404", async () => {
    const res = await createApp(":memory:").request("/api/bookmarks/999", { method: "DELETE" });
    expect(res.status).toBe(404);
    expect(typeof ((await res.json()) as ApiError).error).toBe("string");
  });
});
