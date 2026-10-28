import { describe, expect, test } from "vitest";
import { createApp } from "./app.ts";

describe("the notes API", () => {
  test("GET /api/health returns 200", async () => {
    const res = await createApp(":memory:").request("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
