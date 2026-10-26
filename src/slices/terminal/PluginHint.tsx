import { FC, useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Check, Copy, X } from "lucide-react";

const INSTALL_LINE =
  "claude plugin install event-bridge --marketplace seanrobertwright/claude-mod-events";

/** The installation guide's list of what else keeps the plugin from reporting. */
const OTHER_CAUSES_URL =
  "https://seanrobertwright.github.io/Quay-2/guide/installation#other-causes";

/** The launch flag that turns Claude Code's plugins off, when the terminal's flags hold one. */
export function pluginOffFlag(flags?: string | null): "--bare" | "--safe-mode" | null {
  for (const token of flags?.trim().split(/\s+/) ?? []) {
    if (token === "--bare" || token === "--safe-mode") return token;
  }
  return null;
}

interface PluginHintProps {
  /** The terminal's launch flags. */
  flags?: string | null;
  onDismiss: () => void;
}

const codeClass = "font-mono text-[10.5px] px-1 rounded bg-[#30363d]/70 text-[#e6edf3]";

/**
 * The one-line banner a Claude pane shows when 30 seconds pass after its first output
 * with no event from the event-bridge plugin.
 */
export const PluginHint: FC<PluginHintProps> = ({ flags, onDismiss }) => {
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const offFlag = pluginOffFlag(flags);

  useEffect(() => {
    return () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    };
  }, []);

  const copyInstallLine = async () => {
    try {
      await navigator.clipboard.writeText(INSTALL_LINE);
      setCopied(true);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy the plugin install line:", err);
    }
  };

  return (
    <div
      role="status"
      data-no-terminal-focus
      className="px-2.5 py-1 border-b border-[#d29922]/40 bg-[#d29922]/10 flex items-center gap-2 text-[11px] text-[#c9d1d9] shrink-0"
    >
      <p className="flex-1 min-w-0 leading-5">
        {offFlag ? (
          <>
            This terminal started Claude Code with <code className={codeClass}>{offFlag}</code>,
            which turns plugins off, so Quay can't see its status or replies. Remove the flag and
            relaunch.
          </>
        ) : (
          <>
            No events from the event-bridge plugin. If Claude Code is showing a prompt here, answer
            it. Otherwise install the plugin: <code className={codeClass}>{INSTALL_LINE}</code>{" "}
            <button
              type="button"
              onClick={copyInstallLine}
              aria-label={copied ? "Install line copied" : "Copy the install line"}
              className="inline-flex items-center gap-1 px-1.5 rounded border border-[#30363d] bg-[#21262d] hover:bg-[#30363d] text-[#c9d1d9] align-middle cursor-pointer"
            >
              {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              <span>{copied ? "Copied" : "Copy"}</span>
            </button>
            , then run <code className={codeClass}>/reload-plugins</code>.{" "}
            <button
              type="button"
              onClick={() => openUrl(OTHER_CAUSES_URL).catch(console.error)}
              className="text-[#58a6ff] hover:text-[#79c0ff] hover:underline cursor-pointer"
            >
              Other causes
            </button>
          </>
        )}
      </p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss the plugin hint"
        title="Dismiss"
        className="p-0.5 rounded text-[#8b949e] hover:text-white hover:bg-[#30363d] cursor-pointer shrink-0"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};
