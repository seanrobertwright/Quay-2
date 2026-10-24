import { describe, expect, test } from "vitest";
import { createApp } from "../server/app.ts";

/** Request headers that log in as `name`, as the cookie GET /login/<name> sets. */
function as(name: "alice" | "bob"): { headers: Record<string, string> } {
  return { headers: { Cookie: `user=${name}` } };
}

describe("login", () => {
  test("GET /api/notes without a cookie returns 401", async () => {
    const app = createApp(":memory:");
    const res = await app.request("/api/notes");
    expect(res.status).toBe(401);
  });

  test("GET /login/alice sets the user cookie and redirects to /", async () => {
    const app = createApp(":memory:");
    const res = await app.request("/login/alice");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/");
    expect(res.headers.get("set-cookie")).toMatch(/^user=alice;/);
  });
});

describe("the notes API", () => {
  test("POST /api/notes as alice returns 201 with an id", async () => {
    const app = createApp(":memory:");
    const res = await app.request("/api/notes", {
      method: "POST",
      headers: { ...as("alice").headers, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Holiday", body: "Book the train" }),
    });
    expect(res.status).toBe(201);
    const note = await res.json();
    expect(note.id).toEqual(expect.any(Number));
    expect(note.title).toBe("Holiday");
  });

  test("GET /api/notes as alice lists only alice's notes, newest first", async () => {
    const app = createApp(":memory:");
    const res = await app.request("/api/notes", as("alice"));
    expect(res.status).toBe(200);
    const notes: { title: string }[] = await res.json();
    expect(notes.map((note) => note.title)).toEqual(["Ideas", "Groceries"]);
  });

  test("GET /api/notes/search?q=Groc as alice finds Groceries", async () => {
    const app = createApp(":memory:");
    const res = await app.request("/api/notes/search?q=Groc", as("alice"));
    expect(res.status).toBe(200);
    const notes: { title: string }[] = await res.json();
    expect(notes.map((note) => note.title)).toEqual(["Groceries"]);
  });

  test("DELETE /api/notes/1 as alice returns 204 and the note is gone", async () => {
    const app = createApp(":memory:");
    const res = await app.request("/api/notes/1", { method: "DELETE", ...as("alice") });
    expect(res.status).toBe(204);
    const notes: { title: string }[] = await (await app.request("/api/notes", as("alice"))).json();
    expect(notes.map((note) => note.title)).toEqual(["Ideas"]);
  });
});

describe("the pages", () => {
  test("GET / as alice shows her notes and bob's shared one, not his secret", async () => {
    const app = createApp(":memory:");
    const res = await app.request("/", as("alice"));
    expect(res.status).toBe(200);
    const page = await res.text();
    expect(page).toContain("Groceries");
    expect(page).toContain("Team lunch");
    expect(page).not.toContain("Bob's secret");
  });

  test("GET /notes/3 as alice returns 404", async () => {
    const app = createApp(":memory:");
    const res = await app.request("/notes/3", as("alice"));
    expect(res.status).toBe(404);
  });
});
