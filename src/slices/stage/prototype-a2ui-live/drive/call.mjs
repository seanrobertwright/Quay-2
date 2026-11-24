// The fake CLI: run inside a Quay terminal, so the terminal's own URL and token are used.
// node call.mjs <tool> <arguments.json> <out.json>
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
const [tool, file, out] = process.argv.slice(2);
const body = {
  jsonrpc: "2.0",
  id: 1,
  method: "tools/call",
  params: { name: tool, arguments: JSON.parse(readFileSync(file, "utf8")) },
};
const started = performance.now();
const res = await fetch(process.env.QUAY_MCP_URL, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${process.env.QUAY_A2A_TOKEN}` },
  body: JSON.stringify(body),
});
const answer = await res.json();
const ms = Math.round((performance.now() - started) * 10) / 10;
writeFileSync(out, JSON.stringify({ ms, status: res.status, answer }));
console.log(`${tool} ${file} ${ms}ms`, JSON.stringify(answer).slice(0, 300));
appendFileSync("C:/scratch/q711/out/calls.log", `${tool} ${file} ${ms}ms ${JSON.stringify(answer).slice(0, 600)}\n`);
