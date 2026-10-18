import { FC, useEffect, useId, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AlertTriangle, FileCode2 } from "lucide-react";
import { FactoryConfig, ProjectFactoryInfo } from "./types";

interface FactoryConfigPanelProps {
  activeProject: string;
  projectInfo: ProjectFactoryInfo | null;
  projectError: string | null;
  onSaved: (info: ProjectFactoryInfo) => void;
}

/** A starting point, shown only when the project has no config yet. */
const EXAMPLE: FactoryConfig = {
  version: 1,
  protectedPaths: [".machina/**"],
  outOfScope: [],
  setup: [{ name: "install", run: "pnpm install --frozen-lockfile" }],
  tier1: [
    { name: "typecheck", run: "pnpm exec tsc --noEmit" },
    { name: "unit tests", run: "pnpm test" },
  ],
  tier2: [{ name: "holdbacks", run: "node --test .machina/holdbacks" }],
  timeoutSec: 900,
};

function pretty(cfg: FactoryConfig): string {
  return `${JSON.stringify(cfg, null, 2)}\n`;
}

export const FactoryConfigPanel: FC<FactoryConfigPanelProps> = ({
  activeProject,
  projectInfo,
  projectError,
  onSaved,
}) => {
  const editorId = useId();
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [approving, setApproving] = useState(false);

  // Reload the editor whenever the project or its saved config changes.
  useEffect(() => {
    setText(projectInfo ? pretty(projectInfo.config) : "");
    setError(null);
    setSaved(false);
  }, [projectInfo]);

  if (!projectInfo) {
    return (
      <p className="text-xs text-[#ff7b72]">{projectError ?? "Loading the active project…"}</p>
    );
  }

  const save = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const info = await invoke<ProjectFactoryInfo>("machina_save_project_config", {
        projectPath: activeProject,
        configJson: text,
      });
      onSaved(info);
      setSaved(true);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const approve = async () => {
    if (!projectInfo.configSha256) return;
    setApproving(true);
    setError(null);
    try {
      const info = await invoke<ProjectFactoryInfo>("machina_approve_project_config", {
        projectPath: activeProject,
        sha256: projectInfo.configSha256,
      });
      onSaved(info);
    } catch (e) {
      setError(String(e));
    } finally {
      setApproving(false);
    }
  };

  const hb = projectInfo.holdbacks;
  const needsApproval = projectInfo.configExists && !projectInfo.configError && !projectInfo.configApproved;
  // Approval covers the file on disk, so it is only offered while the editor shows exactly that.
  const editorMatchesDisk = text === pretty(projectInfo.config);

  return (
    <div className="max-w-4xl space-y-4">
      <div>
        <h3 className="text-base font-bold text-white flex items-center gap-2">
          <FileCode2 className="w-4 h-4 text-[#58a6ff]" aria-hidden="true" />
          Factory config
        </h3>
        <p className="text-xs text-[#8b949e] font-mono break-all">{projectInfo.configPath}</p>
        <p className="mt-1 text-xs text-[#8b949e]">
          The gate always reads this file from the main checkout, never from a work order's worktree, and treats
          it and .machina/holdbacks/ as protected in every work order. Saving here approves the saved version;
          a file changed outside Quay needs approval again.
        </p>
      </div>

      {needsApproval && (
        <div role="alert" className="p-3 rounded-lg border-2 border-[#d29922] bg-[#d29922]/10 text-xs text-[#d29922] space-y-2">
          <p>
            This file has not been approved, or changed since it was. Machina runs its setup and gate commands only
            after you approve this exact version. Check the commands in the editor below first: they run on this
            machine with your permissions.
          </p>
          <p className="font-mono text-[11px] text-[#8b949e] break-all">sha256 {projectInfo.configSha256}</p>
          <button
            type="button"
            disabled={approving || !editorMatchesDisk}
            onClick={approve}
            className="px-3 py-1.5 rounded bg-[#d29922] text-[#0d1117] font-bold disabled:opacity-50"
          >
            {approving ? "Approving…" : "Approve these commands"}
          </button>
          {!editorMatchesDisk && (
            <p className="text-[11px]">The editor has unsaved changes. Save them (which approves them) or reload.</p>
          )}
        </div>
      )}
      {projectInfo.configApproved && (
        <p className="text-xs text-[#3fb950]">Approved: this exact file's commands may run.</p>
      )}

      {projectInfo.configError && (
        <div role="alert" className="p-2.5 rounded-lg border border-[#f85149]/50 bg-[#f85149]/10 text-xs text-[#ff7b72]">
          The saved file is invalid: {projectInfo.configError}. The editor shows the defaults.
        </div>
      )}
      {!projectInfo.configExists && (
        <div className="p-2.5 rounded-lg border border-[#30363d] bg-[#161b22] text-xs text-[#c9d1d9] flex items-center gap-3">
          <span className="flex-1">
            No config yet; the defaults below are in effect. Without tier1 checks every gate is inconclusive.
          </span>
          <button
            type="button"
            onClick={() => setText(pretty(EXAMPLE))}
            className="px-2.5 py-1 rounded bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] text-white whitespace-nowrap"
          >
            Insert an example
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_18rem] gap-4">
        <div>
          <label htmlFor={editorId} className="block text-[11px] font-semibold text-[#c9d1d9] mb-1">
            .machina/factory.json
          </label>
          <textarea
            id={editorId}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setSaved(false);
            }}
            spellCheck={false}
            className="w-full min-h-96 px-3 py-2 rounded-lg bg-[#010409] border border-[#30363d] font-mono text-xs text-[#c9d1d9] focus:border-[#58a6ff] focus:outline-none"
          />
          {error && (
            <div role="alert" className="mt-2 p-2 rounded border border-[#f85149]/50 bg-[#f85149]/10 text-xs text-[#ff7b72]">
              {error}
            </div>
          )}
          <div className="mt-2 flex items-center gap-3">
            <button
              type="button"
              disabled={saving}
              onClick={save}
              className="px-4 py-2 rounded-lg bg-[#238636] hover:bg-[#2ea043] text-white text-xs font-bold disabled:opacity-50"
            >
              {saving ? "Saving…" : "Validate and save"}
            </button>
            {saved && (
              <span role="status" className="text-xs text-[#3fb950]">
                Saved.
              </span>
            )}
          </div>
        </div>

        <div className="space-y-3 text-xs text-[#c9d1d9]">
          <section className="p-3 rounded-lg bg-[#161b22] border border-[#30363d] space-y-1.5">
            <h4 className="font-bold text-white">Fields</h4>
            <dl className="space-y-1.5 text-[11px]">
              <div>
                <dt className="font-mono text-[#58a6ff]">setup</dt>
                <dd>Runs once in each new worktree, e.g. installing dependencies.</dd>
              </div>
              <div>
                <dt className="font-mono text-[#58a6ff]">tier1</dt>
                <dd>Build, lint and test. Full output goes back to the author.</dd>
              </div>
              <div>
                <dt className="font-mono text-[#58a6ff]">tier2</dt>
                <dd>
                  Runs with the vaulted holdbacks restored to .machina/holdbacks/ (also in{" "}
                  <code>MACHINA_HOLDBACKS</code>). The author sees only lines starting with{" "}
                  <code>HOLDOUT_FAIL:</code>.
                </dd>
              </div>
              <div>
                <dt className="font-mono text-[#58a6ff]">protectedPaths</dt>
                <dd>Repo-relative globs no work order may change.</dd>
              </div>
              <div>
                <dt className="font-mono text-[#58a6ff]">outOfScope</dt>
                <dd>Phrases that put a work order on hold when its title or objective contains them.</dd>
              </div>
              <div>
                <dt className="font-mono text-[#58a6ff]">timeoutSec</dt>
                <dd>Limit per command, 10 to 7200.</dd>
              </div>
            </dl>
            <p className="text-[11px] text-[#8b949e]">
              Commands run with <code>cmd /C</code> in the worktree, with <code>MACHINA_WORK_ORDER</code> and{" "}
              <code>MACHINA_WORKTREE</code> set.
            </p>
          </section>

          <section className="p-3 rounded-lg bg-[#161b22] border border-[#30363d] space-y-1">
            <h4 className="font-bold text-white">Holdbacks</h4>
            <p className="font-mono text-[11px] break-all text-[#8b949e]">{hb.path}</p>
            <p>
              {hb.exists ? `${hb.fileCount} file(s) will be vaulted into each new work order.` : "None yet."}
            </p>
            {hb.trackedInGit && (
              <p className="flex items-start gap-1.5 text-[11px] text-[#d29922]">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
                Committed to git, so authors can read them from history. Untrack them and add
                .machina/holdbacks/ to .gitignore to keep them blind.
              </p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};
