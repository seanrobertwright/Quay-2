import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";

const dbPath = process.env.NOTES_DB ?? "data/notes.db";
if (dbPath.trim() === "") {
  console.error("NOTES_DB is set but empty: give it a database file, such as data/notes.db");
  process.exit(1);
}

serve({ fetch: createApp(dbPath).fetch, port: 3000 }, (info) => {
  console.log(`Listening on http://localhost:${info.port}`);
});
