#!/usr/bin/env node
// PROTOTYPE (#708), throwaway. A loopback proxy between a CLI and its model provider that
// writes each request body to a file, so what reaches the model can be read and not guessed.
// Request headers are never written. Usage: node wire.mjs <port> <upstream origin+path> <log>
import { appendFileSync } from "node:fs";
import { createServer } from "node:http";

const [port, upstream, logPath] = process.argv.slice(2);
if (!/^\d+$/.test(port ?? "") || !/^https:\/\/|^http:\/\/(127\.0\.0\.1|localhost):/.test(upstream ?? "") || !logPath) {
  console.error("usage: node wire.mjs <port> <upstream> <log file>");
  process.exit(2);
}

createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = Buffer.concat(chunks);
  const at = new Date().toISOString();
  let parsed = null;
  try {
    parsed = JSON.parse(body.toString("utf8"));
  } catch {
    // not JSON: logged as its length only
  }
  appendFileSync(logPath, `${JSON.stringify({ at, method: request.method, path: request.url, bytes: body.length, body: parsed })}\n`);
  const headers = { ...request.headers };
  for (const name of ["host", "connection", "content-length", "transfer-encoding", "accept-encoding"]) delete headers[name];
  try {
    const answer = await fetch(upstream + request.url, {
      method: request.method,
      headers,
      body: body.length ? body : undefined,
      redirect: "manual",
      signal: AbortSignal.timeout(300_000),
    });
    const passed = {};
    const type = answer.headers.get("content-type");
    if (type) passed["content-type"] = type;
    response.writeHead(answer.status, passed);
    if (answer.body) for await (const chunk of answer.body) response.write(chunk);
    response.end();
  } catch (error) {
    appendFileSync(logPath, `${JSON.stringify({ at, error: String(error) })}\n`);
    if (!response.headersSent) response.writeHead(502);
    response.end();
  }
}).listen(Number(port), "127.0.0.1");
