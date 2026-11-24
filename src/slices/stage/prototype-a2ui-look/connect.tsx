// PROTOTYPE (#696), throwaway. The Connect control in Quay's settings, for a CLI whose own
// configuration Quay must write: A rows that open, B a dialog, C the file before and after.
import { useState } from "react";
import { AgentIcon } from "../../terminal/AgentIcons.tsx";
import type { RunKind } from "../../terminal/types.ts";
import { PRIMARY, SECONDARY } from "../../companion/buttonStyles.ts";
import type { Key } from "./frame.tsx";

const PATH = "%USERPROFILE%\\.gemini\\antigravity\\mcp_config.json";
const ENTRY = `"quay": {
  "command": "%LOCALAPPDATA%\\\\Quay\\\\quay-relay.exe",
  "timeoutSeconds": 150
}`;
const before = `{
  "mcpServers": {
    "github": { "command": "github-mcp" }
  }
}`;
const after: [string, boolean][] = [
  ["{", false],
  ['  "mcpServers": {', false],
  ['    "github": { "command": "github-mcp" },', false],
  ...ENTRY.split("\n").map((l): [string, boolean] => [`    ${l}`, true]),
  ["  }", false],
  ["}", false],
];
const AUTO: [RunKind, string][] = [
  ["claude", "Claude Code"],
  ["codex", "Codex"],
  ["opencode", "OpenCode"],
  ["pig", "PiG"],
];

const Entry = () => (
  <div className="flex flex-col gap-1.5">
    <div className="text-[11px] text-[#8b949e]">
      Quay adds this entry to <code className="text-[#c9d1d9] break-all">{PATH}</code> and changes nothing else in the file. Remove takes the same entry out.
    </div>
    <pre className="p-2.5 rounded-md border border-[#30363d] bg-[#010409] text-[11px] font-mono text-[#c9d1d9] overflow-x-auto">{ENTRY}</pre>
  </div>
);

export const ConnectSettings = ({ look }: { look: Key }) => {
  const [connected, setConnected] = useState(false);
  const [open, setOpen] = useState(false);
  const act = () => {
    setConnected(!connected);
    setOpen(false);
  };
  const button = connected ? "Remove" : "Connect";
  const preview =
    look === "C" ? (
      <div className="grid grid-cols-2 gap-2">
        {[
          ["Now", connected ? after : before.split("\n").map((l): [string, boolean] => [l, false])],
          ["After", connected ? before.split("\n").map((l): [string, boolean] => [l, false]) : after],
        ].map(([name, lines]) => (
          <div key={name as string} className="min-w-0">
            <div className="text-[11px] text-[#8b949e] mb-1">{name as string}</div>
            <pre className="p-2 rounded-md border border-[#30363d] bg-[#010409] text-[10px] font-mono overflow-x-auto">
              {(lines as [string, boolean][]).map(([l, added]) => (
                <div key={l + String(added)} className={added ? "bg-[#238636]/25 text-[#7ee787]" : "text-[#8b949e]"}>
                  {l}
                </div>
              ))}
            </pre>
          </div>
        ))}
        <code className="col-span-2 text-[11px] text-[#c9d1d9] break-all">{PATH}</code>
      </div>
    ) : (
      <Entry />
    );
  const actions = (
    <div className="flex gap-2">
      <button type="button" className={connected ? SECONDARY : PRIMARY} onClick={act}>
        {connected ? "Remove the entry" : "Write the entry"}
      </button>
      <button type="button" className={SECONDARY} onClick={() => setOpen(false)}>
        Cancel
      </button>
    </div>
  );
  return (
    <div className="max-w-2xl mx-auto p-6 flex flex-col gap-4">
      <div>
        <h3 className="text-sm font-semibold text-[#f0f6fc]">Agent surfaces</h3>
        <p className="text-xs text-[#8b949e]">Which CLIs can show you questions, reviews and status boards.</p>
      </div>
      <ul className="rounded-lg border border-[#30363d] divide-y divide-[#30363d] text-xs">
        {AUTO.map(([kind, name]) => (
          <li key={kind} className="h-10 px-3 flex items-center gap-2">
            <AgentIcon kind={kind} className="w-4 h-4" />
            <span className="text-[#c9d1d9]">{name}</span>
            <span className="ml-auto text-[#8b949e]">Connected by Quay at launch</span>
          </li>
        ))}
        <li className="px-3 py-2 flex flex-col gap-2.5">
          <div className="flex items-center gap-2 min-h-6">
            <AgentIcon kind="antigravity" className="w-4 h-4" />
            <span className="text-[#c9d1d9]">Antigravity</span>
            <span className={`ml-auto ${connected ? "text-[#3fb950]" : "text-[#8b949e]"}`}>{connected ? "Connected" : "Not connected"}</span>
            <button type="button" aria-expanded={open} className={SECONDARY} onClick={() => setOpen(!open)}>
              {button}...
            </button>
          </div>
          {open && look !== "B" && (
            <>
              {preview}
              {actions}
            </>
          )}
        </li>
        <li className="h-10 px-3 flex items-center gap-2">
          <AgentIcon kind="aider" className="w-4 h-4" />
          <span className="text-[#c9d1d9]">Aider</span>
          <span className="ml-auto text-[#8b949e]">Aider has no tool channel</span>
        </li>
      </ul>
      {open && look === "B" && (
        <div className="absolute inset-0 z-30 bg-black/60 grid place-items-center p-4">
          <div role="dialog" aria-label={`${button} Antigravity`} className="w-full max-w-lg rounded-lg border border-[#30363d] bg-[#161b22] p-4 flex flex-col gap-3 shadow-2xl">
            <h3 className="text-sm font-semibold text-[#f0f6fc]">{button} Antigravity</h3>
            {preview}
            {actions}
          </div>
        </div>
      )}
    </div>
  );
};
