import type { FC } from "react";
import { AlertTriangle, X } from "lucide-react";
import { dismissShellWarning, useShellWarnings } from "./shellWarnings.ts";

/**
 * The shell-wide warnings, between the stage tab bar and the panes at full stage width: one
 * dismissible line per live warning, newest on top. It renders nothing while no warning is live.
 */
export const ShellWarningBanner: FC = () => {
  const warnings = useShellWarnings();
  if (warnings.length === 0) return null;
  return (
    <div className="flex flex-col shrink-0 select-none">
      {warnings.map((warning) => (
        <div
          key={warning.id}
          data-shell-warning
          role="alert"
          className="h-8 bg-[#d29922]/15 border-b border-[#d29922]/40 px-4 flex items-center gap-2 text-xs text-[#e3b341]"
        >
          <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate" title={warning.message}>
            {warning.message}
          </span>
          <button
            type="button"
            onClick={() => dismissShellWarning(warning.id)}
            className="shrink-0 p-1 rounded text-[#e3b341] hover:text-white hover:bg-[#30363d] cursor-pointer"
            aria-label="Dismiss warning"
            title="Dismiss"
          >
            <X className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
};
