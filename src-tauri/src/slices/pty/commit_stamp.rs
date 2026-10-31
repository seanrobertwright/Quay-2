//! Stamps each new commit an agent terminal makes with a `Quay-Agent: <kind>` trailer.
//! An amend, rebase or cherry-pick keeps the stamp, or lack of one, it started with.
//!
//! An agent terminal's env gets one extra `GIT_CONFIG_*` entry pointing `core.hooksPath`
//! at a versioned folder of `sh` forwarders in Quay's storage folder. Nothing is written
//! to the repo or its config.

use std::path::{Path, PathBuf};

use portable_pty::CommandBuilder;

use super::models::RunKind;

/// The forwarders' folder for a terminal launching now, or `None` when the global
/// setting turns stamping off or the folder can't be written, which is logged.
pub fn launch_hooks_dir() -> Option<PathBuf> {
    if !crate::slices::workspace::settings::load().agent_commit_stamping {
        return None;
    }
    let root = crate::slices::workspace::manager::storage_dir();
    install_hooks(&root)
        .map_err(|e| tracing::warn!("Could not write the agent commit hooks; not stamping: {}", e))
        .ok()
}

/// Adds the stamping env to an agent terminal's `cmd` when `hooks_dir` is given, after
/// whatever `GIT_CONFIG_COUNT` it already has. Any other terminal, or a count
/// `stamping_env` rejects, gets no stamping env and loses an inherited agent kind.
pub fn apply(cmd: &mut CommandBuilder, kind: RunKind, hooks_dir: Option<&Path>) {
    cmd.env_remove(KIND_VAR);
    let Some(hooks_dir) = hooks_dir.filter(|_| kind.is_agent()) else {
        return;
    };
    let count = cmd.get_env("GIT_CONFIG_COUNT").map(|v| v.to_string_lossy().into_owned());
    match stamping_env(count.as_deref(), hooks_dir, kind) {
        Ok(vars) => {
            for (k, v) in vars {
                cmd.env(k, v);
            }
        }
        Err(e) => tracing::warn!("Not stamping {} commits: {}", kind.as_str(), e),
    }
}

/// Keeps the stamping env out of `cmd`, a git that Quay runs itself, such as a Topos commit:
/// a commit Quay makes for the operator is a human commit (#353, #366). Quay's own process has
/// that env only when it was started from an agent terminal. The agent kind is removed, and each
/// of Quay's `core.hooksPath` entries is renamed to a key git ignores, the same way the forwarders
/// do it, so the operator's own `GIT_CONFIG_*` entries and the repo's hooks still apply.
pub(crate) fn unstamp(cmd: &mut std::process::Command) {
    cmd.env_remove(KIND_VAR);
    let count = std::env::var("GIT_CONFIG_COUNT").ok().and_then(|n| n.trim().parse::<u32>().ok()).unwrap_or(0);
    for i in 0..count {
        let key = std::env::var(format!("GIT_CONFIG_KEY_{i}")).unwrap_or_default();
        let value = std::env::var(format!("GIT_CONFIG_VALUE_{i}")).unwrap_or_default();
        if key.eq_ignore_ascii_case("core.hooksPath") && value.contains(&format!("/{HOOKS_FOLDER}/")) {
            cmd.env(format!("GIT_CONFIG_KEY_{i}"), "quay.forwardedhookspath");
        }
    }
}

/// Names the agent kind for the `prepare-commit-msg` forwarder.
pub(crate) const KIND_VAR: &str = "QUAY_AGENT_KIND";

/// The folder, under Quay's storage folder, that holds one subfolder per forwarder
/// version. The forwarders find Quay's own `core.hooksPath` entries by this name.
const HOOKS_FOLDER: &str = "quay-agent-hooks";

/// Bump when the forwarder script changes, so a running agent terminal keeps the
/// version its env points at.
const HOOKS_VERSION: &str = "v1";

/// Every client-side hook in githooks(5). `push-to-checkout` is left out: the receiving
/// repo runs it, not the one pushing.
const CLIENT_HOOKS: [&str; 22] = [
    "applypatch-msg",
    "pre-applypatch",
    "post-applypatch",
    "pre-commit",
    "pre-merge-commit",
    "prepare-commit-msg",
    "commit-msg",
    "post-commit",
    "pre-rebase",
    "post-checkout",
    "post-merge",
    "pre-push",
    "reference-transaction",
    "pre-auto-gc",
    "post-rewrite",
    "sendemail-validate",
    "fsmonitor-watchman",
    "p4-changelist",
    "p4-prepare-changelist",
    "p4-post-changelist",
    "p4-pre-submit",
    "post-index-change",
];

/// The forwarder for every hook; `@HOOK@` is replaced with the hook's name. Git for
/// Windows runs it through its bundled `sh`, so it stays POSIX and LF-only.
const FORWARDER: &str = r#"#!/bin/sh
# Quay agent hook forwarder. Quay writes this file; edits are overwritten.
hook=@HOOK@

quay_warn() {
	printf 'quay: %s\n' "$*" >&2
}

# True while a cherry-pick or a rebase (including its squashes) is in progress
quay_rewriting() {
	for state in CHERRY_PICK_HEAD rebase-merge rebase-apply; do
		[ -e "$(git rev-parse --git-path "$state" </dev/null)" ] && return 0
	done
	return 1
}

if [ "$hook" = prepare-commit-msg ] && [ -n "${QUAY_AGENT_KIND:-}" ]; then
	# A message git took from existing commits keeps their stamp, or lack of one:
	# source "commit" is an amend or -c/-C
	if [ "${2:-}" = commit ] || quay_rewriting; then
		:
	elif git interpret-trailers --parse "$1" </dev/null 2>/dev/null | grep -qi '^Quay-Agent:'; then
		:
	elif ! git interpret-trailers --in-place --trailer "Quay-Agent: $QUAY_AGENT_KIND" "$1" </dev/null; then
		quay_warn "could not add the Quay-Agent trailer; committing without it"
	fi
fi

# Ask git for the repo's own hooks dir with every Quay core.hooksPath entry disabled.
# The index is only ever digits, so eval sees no input it did not build.
real_dir=$(
	n=${GIT_CONFIG_COUNT:-0}
	case $n in '' | *[!0-9]*) n=0 ;; esac
	i=0
	while [ "$i" -lt "$n" ]; do
		eval "key=\${GIT_CONFIG_KEY_$i-} value=\${GIT_CONFIG_VALUE_$i-}"
		case $key in
		[Cc][Oo][Rr][Ee].[Hh][Oo][Oo][Kk][Ss][Pp][Aa][Tt][Hh])
			case $value in
			*/quay-agent-hooks/*) export "GIT_CONFIG_KEY_$i=quay.forwardedhookspath" ;;
			esac
			;;
		esac
		i=$((i + 1))
	done
	git rev-parse --git-path hooks </dev/null
) || {
	quay_warn "could not find the repo's hooks dir; skipping its $hook hook"
	exit 0
}

case $real_dir in
*/quay-agent-hooks/*) exit 0 ;;
esac

real="$real_dir/$hook"
if [ -f "$real" ] && [ -x "$real" ]; then
	exec "$real" "$@"
fi
exit 0
"#;

/// Writes the forwarders into a versioned folder under `root` and returns that folder.
/// A forwarder that already holds the right script is left alone.
pub fn install_hooks(root: &Path) -> std::io::Result<PathBuf> {
    let dir = root.join(HOOKS_FOLDER).join(HOOKS_VERSION);
    std::fs::create_dir_all(&dir)?;
    for hook in CLIENT_HOOKS {
        let path = dir.join(hook);
        let script = FORWARDER.replace("@HOOK@", hook);
        if std::fs::read(&path).ok().as_deref() != Some(script.as_bytes()) {
            crate::atomic_file::write_atomic(&path, script.as_bytes())?;
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755))?;
        }
    }
    Ok(dir)
}

/// The variables that add Quay's `core.hooksPath` entry after the `GIT_CONFIG_COUNT`
/// entries already in the env, plus the agent's kind for the trailer. Fails when git
/// would refuse the inherited `GIT_CONFIG_COUNT`, or when it is already `INT_MAX`.
pub fn stamping_env(
    inherited_count: Option<&str>,
    hooks_dir: &Path,
    kind: RunKind,
) -> Result<Vec<(String, String)>, String> {
    // Read the way git does, with `strtol`, so Quay refuses exactly the counts git refuses
    let index: i64 = match inherited_count.map(str::trim_start) {
        None | Some("") => 0,
        Some(raw) => raw
            .parse()
            .ok()
            .filter(|n| (0..=i64::from(i32::MAX)).contains(n))
            .ok_or_else(|| format!("GIT_CONFIG_COUNT is not a count git accepts: {:?}", raw))?,
    };
    // Git also refuses a count above INT_MAX, so Quay's entry must fit under it
    let count = Some(index + 1)
        .filter(|n| *n <= i64::from(i32::MAX))
        .ok_or_else(|| "GIT_CONFIG_COUNT leaves no room for Quay's entry".to_string())?;
    // Forward slashes, so the forwarders can spot Quay's entry on every platform
    let value = hooks_dir.to_string_lossy().replace('\\', "/");
    Ok(vec![
        ("GIT_CONFIG_COUNT".to_string(), count.to_string()),
        (format!("GIT_CONFIG_KEY_{}", index), "core.hooksPath".to_string()),
        (format!("GIT_CONFIG_VALUE_{}", index), value),
        (KIND_VAR.to_string(), kind.as_str().to_string()),
    ])
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    /// A throwaway repo plus a hooks root, both under the temp dir, with git isolated
    /// from the user's own global and system config.
    struct Sandbox {
        dir: PathBuf,
        repo: PathBuf,
        hooks: PathBuf,
    }

    impl Sandbox {
        fn new() -> Self {
            let dir = std::env::temp_dir().join(format!("quay2-stamp-{}", uuid::Uuid::new_v4().simple()));
            let repo = dir.join("repo");
            std::fs::create_dir_all(&repo).unwrap();
            std::fs::write(dir.join("empty.gitconfig"), "").unwrap();
            let hooks = install_hooks(&dir.join("app-data")).unwrap();
            let sandbox = Sandbox { dir, repo, hooks };
            sandbox.git(&["init", "-q", "-b", "main"]).assert_ok();
            sandbox
        }

        /// A `git` in the repo with no stamping env.
        fn plain_git(&self) -> Command {
            let mut cmd = crate::spawn::hidden_command("git");
            cmd.current_dir(&self.repo)
                .env("GIT_CONFIG_GLOBAL", self.dir.join("empty.gitconfig"))
                .env("GIT_CONFIG_NOSYSTEM", "1")
                .env("GIT_AUTHOR_NAME", "Tester")
                .env("GIT_AUTHOR_EMAIL", "tester@example.com")
                .env("GIT_COMMITTER_NAME", "Tester")
                .env("GIT_COMMITTER_EMAIL", "tester@example.com")
                .env_remove("GIT_CONFIG_COUNT")
                .env_remove(KIND_VAR);
            cmd
        }

        fn git(&self, args: &[&str]) -> Out {
            Out(self.plain_git().args(args).output().unwrap())
        }

        /// `git` as an agent terminal of `kind` runs it, after `preset` env entries.
        fn agent_git(&self, kind: RunKind, preset: &[(&str, &str)], args: &[&str]) -> Out {
            let mut cmd = self.plain_git();
            let mut count = None;
            for (k, v) in preset {
                cmd.env(k, v);
                if *k == "GIT_CONFIG_COUNT" {
                    count = Some(v.to_string());
                }
            }
            for (k, v) in stamping_env(count.as_deref(), &self.hooks, kind).unwrap() {
                cmd.env(k, v);
            }
            Out(cmd.args(args).output().unwrap())
        }

        fn commit_file(&self, kind: RunKind, name: &str) -> Out {
            std::fs::write(self.repo.join(name), name).unwrap();
            self.git(&["add", name]).assert_ok();
            self.agent_git(kind, &[], &["commit", "-q", "-m", &format!("add {}", name)])
        }

        fn head_message(&self) -> String {
            self.git(&["log", "-1", "--format=%B"]).stdout()
        }

        fn commit_count(&self) -> usize {
            match self.git(&["rev-list", "--count", "HEAD"]) {
                out if out.0.status.success() => out.stdout().trim().parse().unwrap(),
                _ => 0,
            }
        }

        fn write_hook(&self, dir: &str, name: &str, body: &str) {
            let dir = self.repo.join(dir);
            std::fs::create_dir_all(&dir).unwrap();
            let path = dir.join(name);
            std::fs::write(&path, body).unwrap();
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
            }
        }
    }

    impl Drop for Sandbox {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.dir);
        }
    }

    struct Out(std::process::Output);

    impl Out {
        fn assert_ok(&self) {
            assert!(
                self.0.status.success(),
                "git failed: {}\n{}",
                String::from_utf8_lossy(&self.0.stdout),
                String::from_utf8_lossy(&self.0.stderr)
            );
        }
        fn stdout(&self) -> String {
            String::from_utf8_lossy(&self.0.stdout).into_owned()
        }
        fn stderr(&self) -> String {
            String::from_utf8_lossy(&self.0.stderr).into_owned()
        }
    }

    fn stamps(message: &str) -> Vec<&str> {
        message.lines().filter(|l| l.starts_with("Quay-Agent:")).collect()
    }

    #[test]
    fn a_commit_in_a_repo_with_no_hooks_is_stamped() {
        let sandbox = Sandbox::new();
        sandbox.commit_file(RunKind::Codex, "a.txt").assert_ok();
        assert_eq!(stamps(&sandbox.head_message()), ["Quay-Agent: codex"]);
    }

    #[test]
    fn a_failing_pre_commit_hook_still_blocks_the_commit() {
        let sandbox = Sandbox::new();
        sandbox.write_hook(".git/hooks", "pre-commit", "#!/bin/sh\necho 'lint failed' >&2\nexit 1\n");

        let out = sandbox.commit_file(RunKind::Claude, "a.txt");

        assert!(!out.0.status.success());
        assert!(out.stderr().contains("lint failed"), "{}", out.stderr());
        assert_eq!(sandbox.commit_count(), 0);
    }

    /// Husky 9 sets a relative `core.hooksPath` of `.husky/_` in the repo's config.
    #[test]
    fn a_husky_hook_runs_and_sees_the_stamped_message() {
        let sandbox = Sandbox::new();
        sandbox.git(&["config", "core.hooksPath", ".husky/_"]).assert_ok();
        sandbox.write_hook(".husky/_", "commit-msg", "#!/bin/sh\ncat \"$1\" > husky-saw.txt\n");

        sandbox.commit_file(RunKind::Claude, "a.txt").assert_ok();

        let saw = std::fs::read_to_string(sandbox.repo.join("husky-saw.txt")).unwrap();
        assert_eq!(stamps(&saw), ["Quay-Agent: claude"]);
        assert_eq!(stamps(&sandbox.head_message()), ["Quay-Agent: claude"]);
    }

    #[test]
    fn a_githooks_pre_commit_runs_and_can_block() {
        let sandbox = Sandbox::new();
        sandbox.git(&["config", "core.hooksPath", ".githooks"]).assert_ok();
        sandbox.write_hook(
            ".githooks",
            "pre-commit",
            "#!/bin/sh\ngit diff --cached --name-only | grep -q blocked && { echo 'blocked file' >&2; exit 1; }\nexit 0\n",
        );

        sandbox.commit_file(RunKind::Pig, "ok.txt").assert_ok();
        let out = sandbox.commit_file(RunKind::Pig, "blocked.txt");

        assert!(!out.0.status.success());
        assert!(out.stderr().contains("blocked file"), "{}", out.stderr());
        assert_eq!(sandbox.commit_count(), 1);
        assert_eq!(stamps(&sandbox.head_message()), ["Quay-Agent: pig"]);
    }

    #[test]
    fn a_repo_hook_gets_the_same_arguments_and_stdin() {
        let sandbox = Sandbox::new();
        sandbox.write_hook(
            ".git/hooks",
            "post-rewrite",
            "#!/bin/sh\n{ echo \"args: $*\"; cat; } > rewrite-saw.txt\n",
        );
        sandbox.commit_file(RunKind::Codex, "a.txt").assert_ok();
        let before = sandbox.git(&["rev-parse", "HEAD"]).stdout().trim().to_string();

        sandbox.agent_git(RunKind::Codex, &[], &["commit", "-q", "--amend", "--no-edit"]).assert_ok();

        let after = sandbox.git(&["rev-parse", "HEAD"]).stdout().trim().to_string();
        let saw = std::fs::read_to_string(sandbox.repo.join("rewrite-saw.txt")).unwrap();
        assert_eq!(saw, format!("args: amend\n{} {}\n", before, after));
    }

    #[test]
    fn an_amend_by_another_agent_keeps_the_original_stamp() {
        let sandbox = Sandbox::new();
        sandbox.commit_file(RunKind::Claude, "a.txt").assert_ok();

        sandbox.agent_git(RunKind::Codex, &[], &["commit", "-q", "--amend", "--no-edit"]).assert_ok();

        assert_eq!(stamps(&sandbox.head_message()), ["Quay-Agent: claude"]);
    }

    #[test]
    fn a_message_that_already_has_a_stamp_is_left_alone() {
        let sandbox = Sandbox::new();
        std::fs::write(sandbox.repo.join("a.txt"), "a").unwrap();
        sandbox.git(&["add", "a.txt"]).assert_ok();

        sandbox
            .agent_git(RunKind::Codex, &[], &["commit", "-q", "-m", "add a\n\nquay-agent: claude"])
            .assert_ok();

        let message = sandbox.head_message();
        assert!(message.contains("quay-agent: claude"), "{}", message);
        assert!(!message.contains("codex"), "{}", message);
    }

    /// Rebase, cherry-pick and amend keep the original stamp, and a human commit has none.
    #[test]
    fn rewriting_a_human_commit_does_not_stamp_it() {
        let sandbox = Sandbox::new();
        std::fs::write(sandbox.repo.join("base.txt"), "base").unwrap();
        sandbox.git(&["add", "base.txt"]).assert_ok();
        sandbox.git(&["commit", "-q", "-m", "base"]).assert_ok();
        sandbox.git(&["checkout", "-q", "-b", "side"]).assert_ok();
        std::fs::write(sandbox.repo.join("human.txt"), "human").unwrap();
        sandbox.git(&["add", "human.txt"]).assert_ok();
        sandbox.git(&["commit", "-q", "-m", "human work"]).assert_ok();
        sandbox.git(&["checkout", "-q", "main"]).assert_ok();
        sandbox.commit_file(RunKind::Claude, "agent.txt").assert_ok();

        sandbox.agent_git(RunKind::Claude, &[], &["cherry-pick", "side"]).assert_ok();
        assert_eq!(stamps(&sandbox.head_message()), Vec::<&str>::new(), "cherry-pick");

        sandbox.agent_git(RunKind::Claude, &[], &["commit", "-q", "--amend", "--no-edit"]).assert_ok();
        assert_eq!(stamps(&sandbox.head_message()), Vec::<&str>::new(), "amend");

        sandbox.git(&["checkout", "-q", "side"]).assert_ok();
        sandbox.agent_git(RunKind::Claude, &[], &["rebase", "-q", "--force-rebase", "main~1"]).assert_ok();
        assert_eq!(stamps(&sandbox.head_message()), Vec::<&str>::new(), "rebase");

        std::fs::write(sandbox.repo.join("human2.txt"), "human2").unwrap();
        sandbox.git(&["add", "human2.txt"]).assert_ok();
        sandbox.git(&["commit", "-q", "-m", "more human work"]).assert_ok();
        let before = sandbox.commit_count();
        let squash = [("GIT_SEQUENCE_EDITOR", "sed -i 2s/^pick/squash/"), ("GIT_EDITOR", "true")];
        sandbox.agent_git(RunKind::Claude, &squash, &["rebase", "-q", "-i", "HEAD~2"]).assert_ok();
        assert_eq!(sandbox.commit_count(), before - 1, "squash");
        assert_eq!(stamps(&sandbox.head_message()), Vec::<&str>::new(), "squash");
    }

    #[test]
    fn preset_git_config_entries_are_kept_and_quay_appends_after_them() {
        let sandbox = Sandbox::new();
        let env_hooks = sandbox.dir.join("env-hooks").to_string_lossy().replace('\\', "/");
        sandbox.write_hook(
            "../env-hooks",
            "pre-commit",
            "#!/bin/sh\ngit config quay.test > preset-saw.txt\n",
        );
        let preset = [
            ("GIT_CONFIG_COUNT", "2"),
            ("GIT_CONFIG_KEY_0", "core.hooksPath"),
            ("GIT_CONFIG_VALUE_0", env_hooks.as_str()),
            ("GIT_CONFIG_KEY_1", "quay.test"),
            ("GIT_CONFIG_VALUE_1", "kept"),
        ];
        std::fs::write(sandbox.repo.join("a.txt"), "a").unwrap();
        sandbox.git(&["add", "a.txt"]).assert_ok();

        sandbox.agent_git(RunKind::Gemini, &preset, &["commit", "-q", "-m", "add a"]).assert_ok();

        let saw = std::fs::read_to_string(sandbox.repo.join("preset-saw.txt")).unwrap();
        assert_eq!(saw.trim(), "kept");
        assert_eq!(stamps(&sandbox.head_message()), ["Quay-Agent: gemini"]);
    }

    #[test]
    fn quay_appends_its_entry_after_a_preset_count() {
        let env = stamping_env(Some("2"), Path::new("C:\\data\\hooks"), RunKind::Claude).unwrap();
        assert_eq!(
            env,
            [
                ("GIT_CONFIG_COUNT".to_string(), "3".to_string()),
                ("GIT_CONFIG_KEY_2".to_string(), "core.hooksPath".to_string()),
                ("GIT_CONFIG_VALUE_2".to_string(), "C:/data/hooks".to_string()),
                (KIND_VAR.to_string(), "claude".to_string()),
            ]
        );
    }

    #[test]
    fn with_stamping_off_an_agent_terminal_gets_no_stamping_env() {
        let mut cmd = CommandBuilder::new("codex");
        cmd.env(KIND_VAR, "claude");

        apply(&mut cmd, RunKind::Codex, None);

        assert_eq!(cmd.get_env(KIND_VAR), None);
        assert_eq!(cmd.get_env("GIT_CONFIG_COUNT"), None);
    }

    /// Git reads the count with `strtol`: leading space and an empty value are fine,
    /// trailing junk, a negative count and one above `INT_MAX` are refused.
    #[test]
    fn a_count_git_would_refuse_turns_stamping_off() {
        for bad in ["two", "2x", "-1", "2147483648", "2147483647"] {
            assert!(stamping_env(Some(bad), Path::new("/hooks"), RunKind::Claude).is_err(), "{:?}", bad);
        }
    }

    #[test]
    fn a_count_git_accepts_is_appended_to() {
        for (raw, index) in [("", 0), (" 2", 2), ("+1", 1), ("2147483646", 2147483646)] {
            let env = stamping_env(Some(raw), Path::new("/hooks"), RunKind::Claude).unwrap();
            assert_eq!(env[1].0, format!("GIT_CONFIG_KEY_{}", index), "{:?}", raw);
        }
    }

    #[test]
    fn a_stamp_that_cannot_be_written_warns_and_lets_the_commit_go_on() {
        let sandbox = Sandbox::new();
        std::fs::create_dir(sandbox.repo.join("not-a-message")).unwrap();

        let out = sandbox.agent_git(
            RunKind::Claude,
            &[],
            &["hook", "run", "prepare-commit-msg", "--", "not-a-message", "message"],
        );

        out.assert_ok();
        assert!(out.stderr().contains("quay: could not add the Quay-Agent trailer"), "{}", out.stderr());
    }

    #[test]
    fn the_stamped_kind_is_the_run_kinds_serde_name() {
        for kind in [RunKind::Antigravity, RunKind::OpenCode, RunKind::Archon, RunKind::Copilot] {
            let serde = serde_json::to_value(kind).unwrap();
            assert_eq!(serde.as_str(), Some(kind.as_str()));
        }
    }

    #[test]
    fn every_forwarder_is_lf_only_posix_sh() {
        let sandbox = Sandbox::new();
        for hook in CLIENT_HOOKS {
            let script = std::fs::read(sandbox.hooks.join(hook)).unwrap();
            assert!(script.starts_with(b"#!/bin/sh\n"), "{}", hook);
            assert!(!script.contains(&b'\r'), "{}", hook);
        }
    }
}
