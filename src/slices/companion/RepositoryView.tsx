import type { ReactNode } from "react";
import type { TerminalInfo } from "../terminal/types.ts";
import type { TerminalRepository } from "./terminalRepository.ts";

/**
 * The selected terminal's repository: its name, the terminal, its branch and its folder, then
 * `children`, such as the Link to... control.
 */
export const RepositoryView = ({
  terminal,
  repository,
  children,
}: {
  terminal: TerminalInfo;
  repository: TerminalRepository;
  children?: ReactNode;
}) => (
  <div className="p-4 space-y-3 text-xs">
    <h2 className="text-sm font-semibold text-white truncate" title={repository.path}>
      {repository.name}
    </h2>
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
      <dt className="text-[#8b949e]">Terminal</dt>
      <dd className="truncate text-[#c9d1d9]">{terminal.name}</dd>
      <dt className="text-[#8b949e]">Branch</dt>
      <dd className="truncate font-mono text-[#c9d1d9]">
        {repository.branch ?? "Not known"}
        {repository.worktree && <span className="ml-1.5 font-sans text-[#8b949e]">(worktree)</span>}
      </dd>
      <dt className="text-[#8b949e]">Folder</dt>
      <dd className="break-all font-mono text-[#c9d1d9]">{repository.workingFolder}</dd>
    </dl>
    {children}
  </div>
);
