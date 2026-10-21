import React from "react";
import { RunKind } from "./types";

/** Official Anthropic Claude brand mark (sunburst asterisk) */
export const ClaudeIcon: React.FC<{ className?: string }> = ({ className = "w-4 h-4" }) => (
  <svg
    viewBox="0 0 24 24"
    fill="currentColor"
    className={className}
    aria-label="Claude Code"
  >
    <path d="M13.6 2.4c-.2-.5-.8-.7-1.3-.5l-1.8.8c-.5.2-.7.8-.5 1.3l2.8 6.7H4.3c-.6 0-1 .4-1 1v2c0 .6.4 1 1 1h8.5l-2.8 6.7c-.2.5 0 1.1.5 1.3l1.8.8c.5.2 1.1 0 1.3-.5l3.8-8.9c.2-.5 0-1.1-.5-1.3l-.6-.3 4.8-2c.5-.2.7-.8.5-1.3l-.8-1.8c-.2-.5-.8-.7-1.3-.5l-4.5 1.9-1.5-3.6z" />
  </svg>
);

/** Official Google Antigravity / Gemini diamond star mark */
export const AntigravityIcon: React.FC<{ className?: string }> = ({ className = "w-4 h-4" }) => (
  <svg
    viewBox="0 0 24 24"
    fill="currentColor"
    className={className}
    aria-label="Antigravity CLI"
  >
    {/* Primary 4-pointed Gemini star */}
    <path d="M12 1.5C12 7.299 7.299 12 1.5 12C7.299 12 12 16.701 12 22.5C12 16.701 16.701 12 22.5 12C16.701 12 12 7.299 12 1.5Z" />
    {/* Secondary accent spark */}
    <path d="M19.5 2C19.5 4.209 17.709 6 15.5 6C17.709 6 19.5 7.791 19.5 10C19.5 7.791 21.291 6 23.5 6C21.291 6 19.5 4.209 19.5 2Z" />
  </svg>
);

/** Official OpenAI Codex spiral rosette knot mark */
export const CodexIcon: React.FC<{ className?: string }> = ({ className = "w-4 h-4" }) => (
  <svg
    viewBox="0 0 24 24"
    fill="currentColor"
    className={className}
    aria-label="Codex CLI"
  >
    <path d="M22.28 9.37a5.998 5.998 0 0 0-.52-4.96 6.07 6.07 0 0 0-6.62-2.81A5.996 5.996 0 0 0 10.74.52a6.07 6.07 0 0 0-5.18 3.03 6.002 6.002 0 0 0-3.94 2.87 6.07 6.07 0 0 0 .76 7.23 6.002 6.002 0 0 0 .52 4.96 6.07 6.07 0 0 0 6.62 2.81 5.996 5.996 0 0 0 4.4 1.08 6.07 6.07 0 0 0 5.18-3.03 6.002 6.002 0 0 0 3.94-2.87 6.07 6.07 0 0 0-.76-7.23zm-8.85 12.24a4.47 4.47 0 0 1-2.9-1.07l.14-.08 4.8-2.77a.8.8 0 0 0 .4-.69v-6.76l2.03 1.17a.08.08 0 0 1 .04.06v5.62a4.5 4.5 0 0 1-4.51 4.52zM3.6 18.06a4.48 4.48 0 0 1-.54-3.04l.14.08 4.8 2.77a.8.8 0 0 0 .8 0l5.86-3.38v2.35a.08.08 0 0 1-.03.07l-4.87 2.81a4.5 4.5 0 0 1-6.16-1.66zm-1.4-8.8a4.49 4.49 0 0 1 2.37-1.97v5.7a.8.8 0 0 0 .4.69l5.86 3.38-2.03 1.17a.08.08 0 0 1-.07 0l-4.87-2.81A4.5 4.5 0 0 1 2.2 9.26zm16.74 3.02l-5.86-3.38 2.03-1.17a.08.08 0 0 1 .07 0l4.87 2.81a4.5 4.5 0 0 1 .74 6.37 4.47 4.47 0 0 1-2.37 1.97v-5.7a.8.8 0 0 0-.4-.9zM20.4 5.94a4.48 4.48 0 0 1 .54 3.04l-.14-.08-4.8-2.77a.8.8 0 0 0-.8 0l-5.86 3.38V7.16a.08.08 0 0 1 .03-.07l4.87-2.81a4.5 4.5 0 0 1 6.16 1.66zM7.37 14.85l-2.03-1.17a.08.08 0 0 1-.04-.06V8a4.5 4.5 0 0 1 7.41-3.45l-.14.08-4.8 2.77a.8.8 0 0 0-.4.69v6.76zm2.34-3.13l2.29-1.32 2.29 1.32v2.64l-2.29 1.32-2.29-1.32v-2.64z" />
  </svg>
);

/** PowerShell console terminal mark */
export const PowerShellIcon: React.FC<{ className?: string }> = ({ className = "w-4 h-4" }) => (
  <svg
    viewBox="0 0 24 24"
    fill="currentColor"
    className={className}
    aria-label="PowerShell"
  >
    <path d="M21 4H3a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h18a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1zm-1 14H4V6h16v12zM7.29 8.71a1 1 0 0 0 0 1.41L9.59 12l-2.3 2.29a1 1 0 0 0 1.41 1.41l3-3a1 1 0 0 0 0-1.41l-3-3a1 1 0 0 0-1.41 0zM13 15h4a1 1 0 1 0 0-2h-4a1 1 0 1 0 0 2z" />
  </svg>
);

/** Custom Command icon */
export const CommandIcon: React.FC<{ className?: string }> = ({ className = "w-4 h-4" }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-label="Command"
  >
    <polyline points="4 17 10 11 4 5" />
    <line x1="12" y1="19" x2="20" y2="19" />
  </svg>
);

/** The Greek letter Pi, which Pi and PiG share. */
const PI_GLYPH =
  "M4 5h16c.6 0 1 .4 1 1s-.4 1-1 1h-3v11c0 1.1-.9 2-2 2s-2-.9-2-2V7h-4v8c0 1.7-1.3 3-3 3s-3-1.3-3-3V7H4c-.6 0-1-.4-1-1s.4-1 1-1z";

/** Official Greek letter Pi mark for Pi Coding Agent */
export const PiIcon: React.FC<{ className?: string }> = ({ className = "w-4 h-4" }) => (
  <svg
    viewBox="0 0 24 24"
    fill="currentColor"
    className={className}
    aria-label="Pi Coding Agent"
  >
    <path d={PI_GLYPH} />
  </svg>
);

/** PiG (Pi in Go): Pi's glyph, shown in Go cyan */
export const PigIcon: React.FC<{ className?: string }> = ({ className = "w-4 h-4" }) => (
  <svg
    viewBox="0 0 24 24"
    fill="currentColor"
    className={className}
    aria-label="PiG (Pi in Go)"
  >
    <path d={PI_GLYPH} />
  </svg>
);

/** Google Gemini CLI 4-point star mark */
export const GeminiIcon: React.FC<{ className?: string }> = ({ className = "w-4 h-4" }) => (
  <svg
    viewBox="0 0 24 24"
    fill="currentColor"
    className={className}
    aria-label="Gemini CLI"
  >
    <path d="M12 2C12 7.5 7.5 12 2 12C7.5 12 12 16.5 12 22C12 16.5 16.5 12 22 12C16.5 12 12 7.5 12 2Z" />
  </svg>
);

/** xAI Grok geometric mark */
export const GrokIcon: React.FC<{ className?: string }> = ({ className = "w-4 h-4" }) => (
  <svg
    viewBox="0 0 24 24"
    fill="currentColor"
    className={className}
    aria-label="Grok CLI"
  >
    <path d="M3.5 3.5h5.2l11.8 17h-5.2L3.5 3.5zm11.8 0h5.2L15 11.4l-2.6-3.7 2.9-4.2zM3.5 20.5h5.2l3.4-4.9-2.6-3.7-6 8.6z" />
  </svg>
);

/** Aider AI pair programming chevron mark */
export const AiderIcon: React.FC<{ className?: string }> = ({ className = "w-4 h-4" }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-label="Aider"
  >
    <polyline points="7 8 3 12 7 16" />
    <polyline points="13 8 9 12 13 16" />
    <line x1="17" y1="18" x2="21" y2="18" />
  </svg>
);

/** Kiro CLI multi-model agent spark mark */
export const KiroIcon: React.FC<{ className?: string }> = ({ className = "w-4 h-4" }) => (
  <svg
    viewBox="0 0 24 24"
    fill="currentColor"
    className={className}
    aria-label="Kiro CLI"
  >
    <path d="M12 2L14.7 9.3L22 12L14.7 14.7L12 22L9.3 14.7L2 12L9.3 9.3L12 2Z" />
    <circle cx="12" cy="12" r="2.5" fill="#0d1117" />
  </svg>
);

/** GitHub Copilot CLI mark */
export const CopilotIcon: React.FC<{ className?: string }> = ({ className = "w-4 h-4" }) => (
  <svg
    viewBox="0 0 24 24"
    fill="currentColor"
    className={className}
    aria-label="GitHub Copilot"
  >
    <path d="M12 2a4 4 0 0 0-4 4v1H6a3 3 0 0 0-3 3v5a3 3 0 0 0 3 3h1v1a3 3 0 0 0 3 3h8a3 3 0 0 0 3-3v-1h1a3 3 0 0 0 3-3v-5a3 3 0 0 0-3-3h-2V6a4 4 0 0 0-4-4zm-2 5V6a2 2 0 1 1 4 0v1h-4zm-3 4h10a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1zm2 10a1 1 0 0 1-1-1v-1h8v1a1 1 0 0 1-1 1h-6z" />
  </svg>
);

/** OpenCode CLI terminal agent mark */
export const OpenCodeIcon: React.FC<{ className?: string }> = ({ className = "w-4 h-4" }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-label="OpenCode CLI"
  >
    <rect x="3" y="3" width="18" height="18" rx="3.5" />
    <path d="M8 9l3 3-3 3" />
    <line x1="13" y1="15" x2="16" y2="15" />
  </svg>
);

import { ArchonIcon } from "../archon/ArchonIcon";
export { ArchonIcon };

/** Helper to render the official icon with authentic brand colors */
export const AgentIcon: React.FC<{ kind?: RunKind; className?: string }> = ({
  kind,
  className = "w-4 h-4",
}) => {
  switch (kind) {
    case "claude":
      return <ClaudeIcon className={`${className} text-[#f0883e]`} />;
    case "antigravity":
      return <AntigravityIcon className={`${className} text-[#38bdf8]`} />;
    case "codex":
      return <CodexIcon className={`${className} text-[#10a37f]`} />;
    case "pi":
      return <PiIcon className={`${className} text-[#c084fc]`} />;
    case "gemini":
      return <GeminiIcon className={`${className} text-[#60a5fa]`} />;
    case "grok":
      return <GrokIcon className={`${className} text-[#f1f5f9]`} />;
    case "aider":
      return <AiderIcon className={`${className} text-[#34d399]`} />;
    case "kiro":
      return <KiroIcon className={`${className} text-[#a855f7]`} />;
    case "copilot":
      return <CopilotIcon className={`${className} text-[#38bdf8]`} />;
    case "opencode":
      return <OpenCodeIcon className={`${className} text-[#f97316]`} />;
    case "pig":
      return <PigIcon className={`${className} text-[#00ADD8]`} />;
    case "archon":
      return <ArchonIcon className={`${className} text-[#a371f7]`} />;
    case "powershell":
      return <PowerShellIcon className={`${className} text-[#58a6ff]`} />;
    case "command":
      return <CommandIcon className={`${className} text-[#3fb950]`} />;
    default:
      return <CommandIcon className={`${className} text-[#8b949e]`} />;
  }
};
