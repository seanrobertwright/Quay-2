// Like call.mjs, but warm: fires one call the moment <out>.go appears.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
const [tool, file, out] = process.argv.slice(2);
const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: tool, arguments: JSON.parse(readFileSync(file, "utf8")) } });
writeFileSync(`${out}.ready`, "1");
while (!existsSync(`${out}.go`)) await new Promise((r) => setTimeout(r, 1));
const started = performance.now();
const res = await fetch(process.env.QUAY_MCP_URL, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${process.env.QUAY_A2A_TOKEN}` }, body });
const answer = await res.json();
writeFileSync(out, JSON.stringify({ ms: Math.round(performance.now() - started), answer }));
