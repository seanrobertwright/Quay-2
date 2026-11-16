// Unit tests for what the Agents panel lists (#644): one row per agent terminal in the project
// with its role, status and latest reply; at most four saved swarms; at most 100 sessions matching
// the search.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { RunKind, TerminalInfo, ClaudeStatus } from "../terminal/types.ts";
import type { TrailMessage } from "../orchestrator/trailMessages.ts";
import type { ClaudeSessionSummary } from "../sessions/types.ts";
import { agentRows, sessionMatches, shownSavedSwarms } from "./agentRows.ts";

const term = (id: string, run_kind: RunKind, project_path = "C:/repo", claude_status: ClaudeStatus = "idle"): TerminalInfo => ({
  id,
  name: id,
  project_path,
  run_kind,
  permission_mode: "normal",
  live_mode: "normal",
  claude_status,
  auto_approved_count: 0,
});
const message = (id: string, to: string, timestamp: number, response: string | null): TrailMessage => ({
  id,
  from_terminal: "user",
  to_terminal: to,
  from_name: "You",
  content: `task ${id}`,
  as_user: true,
  timestamp,
  status: response ? "completed" : "dispatched",
  response,
});

test("an agent row is each agent terminal of the project, with its run kind and bus level as its role, and its status", () => {
  const terminals = [
    term("claude-1", "claude", "C:/repo", "working"),
    term("shell", "powershell"),
    term("runner", "archon"),
    term("gem", "gemini", "C:/repo", "waiting"),
    term("elsewhere", "claude", "C:/other"),
  ];
  assert.deepEqual(
    agentRows(terminals, "C:/repo", []).map((r) => [r.terminal.id, r.role, r.status]),
    [
      ["claude-1", "claude · full peer", "working"],
      ["gem", "gemini · listener", "waiting"],
    ],
  );
});

test("an agent row previews the newest reply the agent gave, and names the message it answered", () => {
  const messages = [
    message("m3", "claude-1", 3_000, null),
    message("m2", "claude-1", 2_000, "Done:\nall tests pass"),
    message("m1", "claude-1", 1_000, "first reply"),
    message("x", "other", 4_000, "not mine"),
  ];
  const [row] = agentRows([term("claude-1", "claude")], "C:/repo", messages);
  assert.deepEqual(row.preview, { messageId: "m2", text: "Done: all tests pass" });
  assert.equal(agentRows([term("quiet", "codex")], "C:/repo", messages)[0].preview, null);
});

test("the panel shows the first four saved swarms", () => {
  const swarms = ["a", "b", "c", "d", "e"].map((id) => ({ id }));
  assert.deepEqual(shownSavedSwarms(swarms).map((s) => s.id), ["a", "b", "c", "d"]);
});

const session = (session_id: string, last_prompt: string, project_path = "C:/repo"): ClaudeSessionSummary => ({
  session_id,
  project_path,
  last_prompt,
  timestamp_ms: 0,
  file_size_bytes: 0,
  message_count: 1,
});

test("session history matches the search in a session's prompt, id or folder, whatever the case", () => {
  const sessions = [session("abc", "Fix the Login bug"), session("def", "write docs", "C:/docs"), session("ghi", "refactor")];
  assert.deepEqual(sessionMatches(sessions, "login").map((s) => s.session_id), ["abc"]);
  assert.deepEqual(sessionMatches(sessions, "DEF").map((s) => s.session_id), ["def"]);
  assert.deepEqual(sessionMatches(sessions, "c:/docs").map((s) => s.session_id), ["def"]);
  assert.deepEqual(sessionMatches(sessions, "  ").map((s) => s.session_id), ["abc", "def", "ghi"]);
});

test("session history lists at most 100 sessions", () => {
  const many = Array.from({ length: 130 }, (_, i) => session(`s${i}`, "prompt"));
  assert.equal(sessionMatches(many, "").length, 100);
  assert.equal(sessionMatches(many, "prompt")[99].session_id, "s99");
});
