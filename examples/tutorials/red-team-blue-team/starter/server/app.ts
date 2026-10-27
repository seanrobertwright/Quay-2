import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { NEWEST_FIRST, NOTE_COLUMNS, openDb, type Note } from "./db.ts";
import { layout, noteCard } from "./pages.ts";

type AppEnv = { Variables: { userId: number } };

/** A note id from the URL: a positive whole number, or null for anything else. */
function parseNoteId(raw: string): number | null {
  return /^[1-9][0-9]*$/.test(raw) ? Number(raw) : null;
}

/** A new note from a request body: a non-empty title, a body and an optional shared flag. */
function parseNewNote(input: unknown): { title: string; body: string; shared: boolean } | null {
  if (typeof input !== "object" || input === null) return null;
  const { title, body, shared } = input as Record<string, unknown>;
  if (typeof title !== "string" || title.trim() === "") return null;
  if (typeof body !== "string") return null;
  if (shared !== undefined && typeof shared !== "boolean") return null;
  return { title, body, shared: shared ?? false };
}

/** The notes app, storing its notes in the SQLite database at `dbPath`. */
export function createApp(dbPath: string): Hono<AppEnv> {
  const db = openDb(dbPath);
  const userNamed = db.prepare("SELECT id FROM users WHERE name = ?");
  const app = new Hono<AppEnv>();

  // Log in as alice or bob. There are no passwords: the user cookie says who you are.
  app.get("/login/:name", (c) => {
    const name = c.req.param("name");
    if (userNamed.get(name) === undefined) return c.text("No such user", 404);
    setCookie(c, "user", name, { path: "/", httpOnly: true, sameSite: "Lax" });
    return c.redirect("/");
  });

  // Every other route needs the user cookie.
  app.use("*", async (c, next) => {
    const name = getCookie(c, "user");
    const user = name === undefined ? undefined : (userNamed.get(name) as { id: number } | undefined);
    if (user === undefined) return c.text("Log in first: /login/alice or /login/bob", 401);
    c.set("userId", user.id);
    await next();
  });

  app.get("/api/notes", (c) => {
    const notes = db
      .prepare(`SELECT ${NOTE_COLUMNS} FROM notes WHERE user_id = ? ${NEWEST_FIRST}`)
      .all(c.get("userId"));
    return c.json(notes);
  });

  app.post("/api/notes", async (c) => {
    const note = parseNewNote(await c.req.json().catch(() => null));
    if (note === null) return c.json({ error: "Send { title, body, shared? }" }, 400);
    const created = db
      .prepare(`INSERT INTO notes (user_id, title, body, shared) VALUES (?, ?, ?, ?) RETURNING ${NOTE_COLUMNS}`)
      .get(c.get("userId"), note.title, note.body, note.shared ? 1 : 0);
    return c.json(created, 201);
  });

  app.get("/api/notes/search", (c) => {
    const q = c.req.query("q") ?? "";
    const notes = db
      .prepare(
        `SELECT ${NOTE_COLUMNS} FROM notes WHERE user_id = ${c.get("userId")} AND title LIKE '%${q}%' ${NEWEST_FIRST}`,
      )
      .all();
    return c.json(notes);
  });

  app.delete("/api/notes/:id", (c) => {
    const id = parseNoteId(c.req.param("id"));
    if (id === null) return c.json({ error: "Not found" }, 404);
    const { changes } = db.prepare("DELETE FROM notes WHERE id = ?").run(id);
    if (changes === 0) return c.json({ error: "Not found" }, 404);
    return c.body(null, 204);
  });

  app.get("/", (c) => {
    const notes = db
      .prepare(`SELECT ${NOTE_COLUMNS} FROM notes WHERE user_id = ? OR shared = 1 ${NEWEST_FIRST}`)
      .all(c.get("userId")) as unknown as Note[];
    return c.html(layout("Notes", notes.map(noteCard).join("")));
  });

  app.get("/notes/:id", (c) => {
    const id = parseNoteId(c.req.param("id"));
    const note =
      id === null
        ? undefined
        : (db
            .prepare(`SELECT ${NOTE_COLUMNS} FROM notes WHERE id = ? AND (user_id = ? OR shared = 1)`)
            .get(id, c.get("userId")) as unknown as Note | undefined);
    if (note === undefined) return c.text("Not found", 404);
    return c.html(layout(note.title, noteCard(note)));
  });

  return app;
}
