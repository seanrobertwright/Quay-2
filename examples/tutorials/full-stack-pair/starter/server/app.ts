import { Hono } from "hono";
import { logger } from "hono/logger";

/**
 * Builds the bookmarks API that API.md describes, storing bookmarks in the SQLite database at
 * `dbPath`, or in memory for ":memory:". Only GET /api/health is written so far.
 */
export function createApp(dbPath: string): Hono {
  const app = new Hono();
  app.use(logger());

  app.get("/api/health", (c) => c.json({ ok: true }));

  return app;
}
