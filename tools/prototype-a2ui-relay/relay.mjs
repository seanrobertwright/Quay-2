#!/usr/bin/env node
// PROTOTYPE (#693), throwaway. A stdio MCP server that forwards every JSON-RPC line to
// Quay's /mcp over HTTP, with the address and token taken from the environment the CLI
// passes down. It logs what it saw of that environment, which is the thing under test.
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { tmpdir } from "node:os";
import { join } from "node:path";

const logPath = process.env.QUAY_A2UI_PROTO_RELAY_LOG || join(tmpdir(), "quay-a2ui-proto-relay.log");
const log = (line) => appendFileSync(logPath, `${new Date().toISOString().slice(11, 23)} [${process.pid}] ${line}\n`);

const url = process.env.QUAY_MCP_URL;
const token = process.env.QUAY_A2A_TOKEN;
log(
  `START QUAY_MCP_URL=${url ?? "<unset>"} QUAY_A2A_TOKEN=${token ? "<set>" : "<unset>"} ` +
    `QUAY_TERMINAL_ID=${process.env.QUAY_TERMINAL_ID ?? "<unset>"} cwd=${process.cwd()}`,
);

// #709: the calls still open, so a cancel can close the HTTP call it names
const openCalls = new Map();

const reply = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);

createInterface({ input: process.stdin }).on("line", async (line) => {
  if (!line.trim()) return;
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    return;
  }
  const name = request.method === "tools/call" ? `tools/call ${request.params?.name}` : request.method;
  const started = Date.now();
  log(`-> ${name} id=${request.id ?? "-"}${request.method?.startsWith("notifications/") ? ` ${JSON.stringify(request.params ?? {})}` : ""}`);
  if (request.method === "notifications/cancelled") {
    const cancelledCall = openCalls.get(request.params?.requestId);
    log(`cancel of id=${request.params?.requestId}: ${cancelledCall ? "closing its HTTP call" : "no open call with that id"}`);
    cancelledCall?.abort();
  }
  if (!url || !token) {
    if (request.id !== undefined) {
      reply({ jsonrpc: "2.0", id: request.id, error: { code: -32000, message: "The relay has no QUAY_MCP_URL or QUAY_A2A_TOKEN in its environment" } });
    }
    return;
  }
  const call = new AbortController();
  if (request.id !== undefined) openCalls.set(request.id, call);
  try {
    const response = await fetch(url, {
      method: "POST",
      signal: call.signal,
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: line,
    });
    const body = await response.text();
    log(`<- ${name} id=${request.id ?? "-"} http=${response.status} after ${((Date.now() - started) / 1000).toFixed(1)}s`);
    if (request.id !== undefined && body) process.stdout.write(`${body.trim()}\n`);
  } catch (error) {
    if (call.signal.aborted) return;
    log(`!! ${name} id=${request.id ?? "-"} ${error} after ${((Date.now() - started) / 1000).toFixed(1)}s`);
    if (request.id !== undefined) {
      reply({ jsonrpc: "2.0", id: request.id, error: { code: -32000, message: `Quay relay: ${error}` } });
    }
  } finally {
    openCalls.delete(request.id);
  }
});

process.stdin.on("end", () => {
  log("STDIN CLOSED");
});
