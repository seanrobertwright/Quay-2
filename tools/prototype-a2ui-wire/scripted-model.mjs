#!/usr/bin/env node
// PROTOTYPE (#708), throwaway. A loopback OpenAI-compatible model with no intelligence, so what
// a CLI sends its model can be read off the wire. A user message holding
// "CALL <part of a tool name> [<JSON arguments>]" is answered with that tool call; anything
// else, and every tool result, is answered with text. Every request body is written to the log.
// Headers are not. Usage: node scripted-model.mjs <port> <log>
import { appendFileSync } from "node:fs";
import { createServer } from "node:http";

const [port, logPath] = process.argv.slice(2);
if (!/^\d+$/.test(port ?? "") || !logPath) {
  console.error("usage: node scripted-model.mjs <port> <log file>");
  process.exit(2);
}
const textOf = (content) =>
  typeof content === "string" ? content : (content ?? []).map((part) => part.text ?? "").join("\n");

createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  let body = {};
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    // a request with no JSON body
  }
  appendFileSync(logPath, `${JSON.stringify({ at: new Date().toISOString(), path: request.url, body })}\n`);
  if (!request.url.endsWith("/chat/completions")) {
    response.writeHead(404).end();
    return;
  }
  const messages = body.messages ?? [];
  const last = messages.at(-1) ?? {};
  const asked = last.role === "user" ? textOf(last.content).match(/CALL (\w+)(?:\s+(\{[^\n]*\}))?/) : null;
  const tool = asked && (body.tools ?? []).find((t) => t.function?.name?.includes(asked[1]));
  const delta = tool
    ? {
        role: "assistant",
        tool_calls: [{ index: 0, id: `call_${Date.now()}`, type: "function", function: { name: tool.function.name, arguments: asked[2] ?? "{}" } }],
      }
    : { role: "assistant", content: last.role === "tool" ? `SCRIPTED: got the result of ${textOf(last.content).length} characters.` : "SCRIPTED: ok." };
  const chunk = (d, finish) =>
    `data: ${JSON.stringify({ id: "x", object: "chat.completion.chunk", created: 0, model: body.model, choices: [{ index: 0, delta: d, finish_reason: finish }] })}\n\n`;
  response.writeHead(200, { "content-type": "text/event-stream" });
  response.end(chunk(delta, null) + chunk({}, tool ? "tool_calls" : "stop") + "data: [DONE]\n\n");
}).listen(Number(port), "127.0.0.1");
