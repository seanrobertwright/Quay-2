// "Install on host…" (#224, #451): how to install a workflow template on a Praxis host, by hand.
// Quay writes nothing here. It never writes the host's configuration or template directory, never
// guesses that directory, and never runs `engine:author`. It opens on the template's state on the
// host, from the host catalog (#363): the copy steps when the host doesn't have it, the steps with
// a warning when the host's copy will be replaced, nothing to do when the host has the saved file,
// and no steps at all when the host refuses the name. When the template file has changes since
// the last commit, the dialog leads with their diff and a warning. With the steps, it lists the
// saved file's three commands in full, read-only. Check again follows the steps. Everything shown
// is read again after a save. Escape closes it, through the builder's cascade.
import { useEffect, useId, useRef, useState, type FC, type Ref } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Copy, TriangleAlert, X } from "lucide-react";
import { DiffBody, useFileDiff } from "./DiffView.tsx";
import { HostStatusLine, type TemplateHost } from "./HostStatusLine.tsx";
import { INSTALL_HOST_NOTES, installOpening } from "./hostStatus.ts";
import { installCommands, installTarget, runCommand, type InstallCommand } from "./install.ts";
import { focusedElement } from "./keyboard.ts";
import { definitionPath } from "./session.ts";
import { argumentsText } from "./template.ts";
import type { GitChange, DefinitionFile } from "./types.ts";

type Read = { state: "loading" } | { state: "failed"; error: string } | { state: "done"; path: string; file: DefinitionFile };

export const InstallDialog: FC<{
  rootRef: Ref<HTMLDivElement>;
  projectPath: string;
  name: string;
  /** How the template file differs from the last commit; undefined when it doesn't. */
  changed: GitChange | undefined;
  /** Changes after each save, so the saved file and its diff are read again. */
  refresh: number;
  /** The open draft has edits the saved file doesn't. */
  unsaved: boolean;
  /** The template's state on the Praxis host, from the host catalog; null without one. */
  host: TemplateHost | null;
  onClose: () => void;
}> = ({ rootRef, projectPath, name, changed, refresh, unsaved, host, onClose }) => {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const [read, setRead] = useState<Read>({ state: "loading" });
  const [copied, setCopied] = useState<string | null>(null);
  const ref = { kind: "templates" as const, id: name };
  // Without a catalog the host state is unknown, and the dialog opens on the steps as before.
  const opening = installOpening(name, host?.view.state ?? { kind: "unknown", why: "notChecked" });

  // Focus goes to Close while it is shown and back to where it was when it closes.
  useEffect(() => {
    const previous = focusedElement();
    closeRef.current?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  // The saved file, which is what gets installed, not the draft.
  useEffect(() => {
    let stale = false;
    setRead({ state: "loading" });
    Promise.all([
      invoke<string>("praxis_path", { projectPath, kind: "templates", id: name }),
      invoke<DefinitionFile>("praxis_read", { projectPath, kind: "templates", id: name }),
    ]).then(
      ([path, file]) => {
        if (!stale) setRead({ state: "done", path, file });
      },
      (e) => {
        if (!stale) setRead({ state: "failed", error: String(e) });
      }
    );
    return () => {
      stale = true;
    };
  }, [projectPath, name, refresh]);

  const copyPath = (path: string) => {
    navigator.clipboard.writeText(path).then(
      () => setCopied("Copied the path."),
      (e) => setCopied(`Couldn't copy the path: ${String(e)}`)
    );
  };

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/60 p-6">
      <div
        ref={rootRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="max-w-3xl w-full max-h-full overflow-y-auto rounded-lg border border-[#30363d] bg-[#161b22] p-4 shadow-2xl text-[#c9d1d9] space-y-3"
      >
        <div className="flex items-center gap-2">
          <h3 id={titleId} className="text-sm font-semibold text-white min-w-0 break-all">
            Install <span className="font-mono">{name}</span> on a host
          </h3>
          <button
            ref={closeRef}
            type="button"
            aria-label="Close install on host"
            onClick={onClose}
            className="ml-auto p-1 rounded-md text-[#8b949e] hover:text-white hover:bg-[#21262d]"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {changed === "unknown" ? (
          <p className="flex items-start gap-1.5 text-xs text-[#e3b341]">
            <TriangleAlert className="w-3.5 h-3.5 mt-px shrink-0" aria-hidden="true" />
            Quay couldn't read git status, so it can't tell whether this template has changes that aren't committed.
          </p>
        ) : (
          changed && <ChangedSinceCommit projectPath={projectPath} target={ref} refresh={refresh} />
        )}
        {unsaved && (
          <p className="flex items-start gap-1.5 text-xs text-[#e3b341]">
            <TriangleAlert className="w-3.5 h-3.5 mt-px shrink-0" aria-hidden="true" />
            The draft has unsaved changes. The host gets the saved file, so save first to install them.
          </p>
        )}
        {opening.kind === "steps" && opening.replaces && (
          <p className="flex items-start gap-1.5 text-xs text-[#e3b341]">
            <TriangleAlert className="w-3.5 h-3.5 mt-px shrink-0" aria-hidden="true" />
            {opening.replaces}
          </p>
        )}
        {opening.kind === "nothingToDo" && <p className="text-xs text-[#c9d1d9]">{opening.message}</p>}
        {opening.kind === "refused" && (
          <section aria-label="Name the host refuses" className="space-y-1">
            <p className="flex items-start gap-1.5 text-xs text-[#ff7b72]">
              <TriangleAlert className="w-3.5 h-3.5 mt-px shrink-0" aria-hidden="true" />
              {opening.message}
            </p>
            <p className="text-xs text-[#8b949e]">{opening.rule}</p>
          </section>
        )}

        {opening.kind === "steps" && read.state === "loading" && <p className="text-xs text-[#6e7681]">Reading {definitionPath(ref)}…</p>}
        {opening.kind === "steps" && read.state === "failed" && (
          <p role="alert" className="text-xs text-[#ff7b72] break-words">
            {read.error}
          </p>
        )}
        {opening.kind === "steps" && read.state === "done" && (
          <>
            <section aria-label="Template file" className="space-y-1">
              <p className="text-xs text-[#8b949e]">Template file</p>
              <div className="flex items-start gap-2">
                <code className="flex-1 min-w-0 break-all rounded-md border border-[#30363d] bg-[#0d1117] px-2 py-1 text-xs font-mono">
                  {read.path}
                </code>
                <button
                  type="button"
                  onClick={() => copyPath(read.path)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-[#30363d] bg-[#21262d] hover:bg-[#30363d] text-xs text-white shrink-0"
                >
                  <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                  Copy
                </button>
              </div>
              <p role="status" className="text-[11px] text-[#8b949e] min-h-4">
                {copied}
              </p>
            </section>

            <section aria-label="Steps" className="space-y-1">
              <p className="text-xs text-[#8b949e]">
                Name it <code className="font-mono text-[#c9d1d9]">{installTarget(name)}</code> on the host. Quay writes nothing
                for an install.
              </p>
              <ol className="list-decimal pl-5 space-y-1 text-xs">
                <li>Copy the file into the template directory your host configuration names.</li>
                <li>Restart the host.</li>
                <li>
                  Run <code className="font-mono">{runCommand(name)}</code>.
                </li>
              </ol>
            </section>

            <section aria-label="Commands the template runs" className="space-y-2">
              <p className="text-xs text-[#8b949e]">The commands this template runs, as the saved file holds them:</p>
              {read.file.content === undefined ? (
                <p className="text-xs text-[#ff7b72]">
                  {read.file.problem?.message ?? `${definitionPath(ref)} has no content.`}
                </p>
              ) : (
                installCommands(read.file.content).map((command) => <CommandShown key={command.key} command={command} />)
              )}
            </section>
          </>
        )}

        {/* A refused name is never read, so there is nothing to check again. */}
        {host && opening.kind !== "refused" && (
          <section aria-label="On the host" className="space-y-1 border-t border-[#30363d] pt-3">
            <HostStatusLine host={host} />
            <ul className="list-disc pl-5 space-y-0.5 text-[11px] text-[#8b949e]">
              {INSTALL_HOST_NOTES.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
};

/** The diff the dialog leads with when the template file has changes since the last commit. */
const ChangedSinceCommit: FC<{ projectPath: string; target: { kind: "templates"; id: string }; refresh: number }> = ({
  projectPath,
  target,
  refresh,
}) => {
  const read = useFileDiff(projectPath, target, refresh);
  return (
    <section aria-label="Changes since the last commit" className="space-y-2">
      <p className="flex items-start gap-1.5 text-xs text-[#e3b341]">
        <TriangleAlert className="w-3.5 h-3.5 mt-px shrink-0" aria-hidden="true" />
        This template has changes that aren't committed. Check them before the host runs it.
      </p>
      <div className="flex flex-col max-h-64">
        <DiffBody read={read} />
      </div>
    </section>
  );
};

const CommandShown: FC<{ command: InstallCommand }> = ({ command }) => {
  const labelId = useId();
  return (
    <div className="space-y-0.5">
      <p id={labelId} className="text-xs font-mono text-white">
        {command.key}
      </p>
      {"missing" in command ? (
        <p className="text-xs text-[#ff7b72]">Not set.</p>
      ) : (
        <pre
          aria-labelledby={labelId}
          className="overflow-x-auto rounded-md border border-[#30363d] bg-[#0d1117] px-2 py-1 text-[11px] leading-4 font-mono"
        >
          {"args" in command ? argumentsText(command.args) : command.json}
        </pre>
      )}
      {"json" in command && <p className="text-[11px] text-[#ff7b72]">This isn't an argument list.</p>}
    </div>
  );
};
