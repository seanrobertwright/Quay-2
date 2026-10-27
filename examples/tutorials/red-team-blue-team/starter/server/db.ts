import { DatabaseSync } from "node:sqlite";

export interface Note {
  id: number;
  user_id: number;
  title: string;
  body: string;
  /** 1 when every user can see the note, 0 when only its owner can. */
  shared: number;
  created_at: string;
}

/** The columns every query that returns notes selects, in `Note`'s order. */
export const NOTE_COLUMNS = "id, user_id, title, body, shared, created_at";

/** The order every query that lists notes uses: newest first, with the later id first on a tie. */
export const NEWEST_FIRST = "ORDER BY created_at DESC, id DESC";

/**
 * Opens the database at `dbPath`, creating the tables and seeding alice and bob when it is new.
 * `":memory:"` opens a fresh database that lives only as long as the app.
 */
export function openDb(dbPath: string): DatabaseSync {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE
    );
    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      shared INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
  `);

  const { count } = db.prepare("SELECT count(*) AS count FROM users").get() as { count: number };
  if (count === 0) {
    db.exec("INSERT INTO users (id, name) VALUES (1, 'alice'), (2, 'bob')");
    const insert = db.prepare("INSERT INTO notes (id, user_id, title, body, shared) VALUES (?, ?, ?, ?, ?)");
    insert.run(1, 1, "Groceries", "Milk, eggs, bread", 0);
    insert.run(2, 1, "Ideas", "A notes app that keeps secrets", 0);
    insert.run(3, 2, "Bob's secret", "the safe code is 4242", 0);
    insert.run(4, 2, "Team lunch", "Friday at noon", 1);
  }
  return db;
}
