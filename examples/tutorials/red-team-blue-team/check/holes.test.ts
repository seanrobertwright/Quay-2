import { describe, expect, test } from "vitest";
import { createApp } from "../server/app.ts";

/** Request headers that log in as `name`, as the cookie GET /login/<name> sets. */
function as(name: "alice" | "bob"): { headers: Record<string, string> } {
  return { headers: { Cookie: `user=${name}` } };
}

/** Posts a note as `name` and returns its id. */
async function post(app: ReturnType<typeof createApp>, name: "alice" | "bob", note: { title: string; body: string; shared?: boolean }): Promise<number> {
  const res = await app.request("/api/notes", {
    method: "POST",
    headers: { ...as(name).headers, "Content-Type": "application/json" },
    body: JSON.stringify(note),
  });
  expect(res.status).toBe(201);
  return (await res.json()).id;
}

async function search(app: ReturnType<typeof createApp>, q: string): Promise<Response> {
  return app.request(`/api/notes/search?${new URLSearchParams({ q })}`, as("alice"));
}

describe("rule 4: search matches titles of your own notes only, and any text is a valid search", () => {
  test("a search built to match every row returns none of bob's notes", async () => {
    const app = createApp(":memory:");
    const res = await search(app, "' OR 1=1 --");
    expect(res.status).toBe(200);
    const notes: { title: string; user_id: number }[] = await res.json();
    expect(notes.filter((note) => note.user_id !== 1)).toEqual([]);
  });

  test("a title with an apostrophe can be found by searching for it", async () => {
    const app = createApp(":memory:");
    await post(app, "alice", { title: "Dinner at O'Brien's", body: "Table for two" });
    const res = await search(app, "O'Brien");
    expect(res.status).toBe(200);
    const notes: { title: string }[] = await res.json();
    expect(notes.map((note) => note.title)).toEqual(["Dinner at O'Brien's"]);
  });
});

describe("rule 3: a note's title and body are shown exactly as typed, as text", () => {
  test("a script bob shares shows on alice's page as text and never runs", async () => {
    const app = createApp(":memory:");
    await post(app, "bob", { title: "Hello", body: "<script>window.pwned = 1</script>", shared: true });
    const page = await (await app.request("/", as("alice"))).text();
    expect(page).toContain("&lt;script&gt;window.pwned = 1&lt;/script&gt;");
    expect(page).not.toContain("<script>window");
  });

  test("an ampersand is shown as typed on the notes page and on the note's own page", async () => {
    const app = createApp(":memory:");
    const id = await post(app, "alice", { title: "Friday", body: "Fish & chips" });
    const notesPage = await (await app.request("/", as("alice"))).text();
    const notePage = await (await app.request(`/notes/${id}`, as("alice"))).text();
    expect(notesPage).toContain("Fish &amp; chips");
    expect(notePage).toContain("Fish &amp; chips");
  });
});

describe("rule 2: only a note's owner can delete it, and a note you can't delete is a 404", () => {
  async function bobsTitles(app: ReturnType<typeof createApp>): Promise<string[]> {
    const notes: { title: string }[] = await (await app.request("/api/notes", as("bob"))).json();
    return notes.map((note) => note.title);
  }

  test("alice can't delete bob's secret note", async () => {
    const app = createApp(":memory:");
    const res = await app.request("/api/notes/3", { method: "DELETE", ...as("alice") });
    expect(res.status).toBe(404);
    expect(await bobsTitles(app)).toContain("Bob's secret");
  });

  test("alice can't delete a note bob shared with her", async () => {
    const app = createApp(":memory:");
    const res = await app.request("/api/notes/4", { method: "DELETE", ...as("alice") });
    expect(res.status).toBe(404);
    expect(await bobsTitles(app)).toContain("Team lunch");
  });
});
