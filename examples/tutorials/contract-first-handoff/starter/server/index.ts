import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createApp } from "./app.ts";

/** The port from PORT, or 3000. Anything but a whole number from 1 to 65535 stops the server. */
function parsePort(value: string | undefined): number {
  if (value === undefined || value === "") return 3000;
  const port = Number(value);
  if (!/^\d+$/.test(value) || port < 1 || port > 65535) {
    throw new Error(`PORT must be a whole number from 1 to 65535, not ${JSON.stringify(value)}`);
  }
  return port;
}

const listenOn = parsePort(process.env.PORT);
const app = createApp(process.env.NOTES_DB ?? "data/notes.db");
// The UI that `vite build web` wrote into dist/, served beside the API.
app.use("/*", serveStatic({ root: "./dist" }));

serve({ fetch: app.fetch, port: listenOn }, () => {
  console.log(`Listening on http://localhost:${listenOn}`);
});
