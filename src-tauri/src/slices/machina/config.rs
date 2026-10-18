//! Per-project factory configuration, read from `<repo>/.machina/factory.json` in the
//! main checkout. The gate always reads this file from the main checkout, never from a
//! work order's worktree, so an author agent cannot weaken its own gate.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::paths::validate_patterns;
use super::vault::sha256_hex;

pub const CONFIG_REL_PATH: &str = ".machina/factory.json";
pub const HOLDBACKS_REL_DIR: &str = ".machina/holdbacks";
pub const WORKTREES_REL_DIR: &str = ".machina/worktrees";
/// Gate feedback for the author, written into the worktree but never committed.
pub const FEEDBACK_REL_DIR: &str = ".machina/feedback";

/// Worktree paths the factory manages itself; candidate commits and the
/// clean-worktree check leave them out.
pub const FACTORY_MANAGED: [&str; 2] = [HOLDBACKS_REL_DIR, FEEDBACK_REL_DIR];

/// Protected regardless of what the config says: the holdbacks and the gate definition.
pub const ALWAYS_PROTECTED: [&str; 2] = [".machina/holdbacks/**", ".machina/factory.json"];

const MIN_TIMEOUT_SEC: u64 = 10;
const MAX_TIMEOUT_SEC: u64 = 7_200;
const MAX_COMMANDS_PER_TIER: usize = 20;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GateCommand {
    pub name: String,
    /// Run through `cmd /C` on Windows and `sh -c` elsewhere, in the worktree.
    pub run: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FactoryConfig {
    #[serde(default = "default_version")]
    pub version: u32,
    /// Paths no work order may change. `ALWAYS_PROTECTED` is added on top.
    #[serde(default = "default_protected")]
    pub protected_paths: Vec<String>,
    /// Phrases that put a work order on hold as scope drift when its title or
    /// objective contains them.
    #[serde(default)]
    pub out_of_scope: Vec<String>,
    /// Run once in each new worktree, e.g. installing dependencies.
    #[serde(default)]
    pub setup: Vec<GateCommand>,
    /// Build, lint and test commands. Their output goes back to the author.
    #[serde(default)]
    pub tier1: Vec<GateCommand>,
    /// Commands that run with the vaulted holdbacks restored into the worktree.
    /// Only `HOLDOUT_FAIL:` lines from their output reach the author.
    #[serde(default)]
    pub tier2: Vec<GateCommand>,
    /// Per-command limit.
    #[serde(default = "default_timeout")]
    pub timeout_sec: u64,
}

fn default_version() -> u32 {
    1
}

fn default_protected() -> Vec<String> {
    vec![".machina/**".to_string()]
}

fn default_timeout() -> u64 {
    900
}

impl Default for FactoryConfig {
    fn default() -> Self {
        Self {
            version: default_version(),
            protected_paths: default_protected(),
            out_of_scope: Vec::new(),
            setup: Vec::new(),
            tier1: Vec::new(),
            tier2: Vec::new(),
            timeout_sec: default_timeout(),
        }
    }
}

fn validate_commands(tier: &str, cmds: &[GateCommand]) -> Result<(), String> {
    if cmds.len() > MAX_COMMANDS_PER_TIER {
        return Err(format!("{} has more than {} commands", tier, MAX_COMMANDS_PER_TIER));
    }
    let mut names: Vec<String> = Vec::new();
    for c in cmds {
        let name = c.name.trim();
        if name.is_empty() {
            return Err(format!("every {} command needs a name", tier));
        }
        if c.run.trim().is_empty() {
            return Err(format!("{} command '{}' has an empty run line", tier, name));
        }
        if c.run.contains(['\n', '\r']) {
            return Err(format!("{} command '{}' must be one line", tier, name));
        }
        let key = name.to_lowercase();
        if names.contains(&key) {
            return Err(format!("{} has two commands named '{}'", tier, name));
        }
        names.push(key);
    }
    Ok(())
}

impl FactoryConfig {
    /// Checks every field and normalizes the path patterns.
    pub fn validated(mut self) -> Result<Self, String> {
        if self.version != 1 {
            return Err(format!("unsupported config version {} (expected 1)", self.version));
        }
        if !(MIN_TIMEOUT_SEC..=MAX_TIMEOUT_SEC).contains(&self.timeout_sec) {
            return Err(format!(
                "timeoutSec must be between {} and {}",
                MIN_TIMEOUT_SEC, MAX_TIMEOUT_SEC
            ));
        }
        self.protected_paths = validate_patterns(&self.protected_paths)?;
        self.out_of_scope = self
            .out_of_scope
            .iter()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        validate_commands("setup", &self.setup)?;
        validate_commands("tier1", &self.tier1)?;
        validate_commands("tier2", &self.tier2)?;
        Ok(self)
    }

    /// Configured protected paths plus `ALWAYS_PROTECTED`.
    pub fn effective_protected(&self) -> Vec<String> {
        let mut out = self.protected_paths.clone();
        for p in ALWAYS_PROTECTED {
            if !out.iter().any(|q| q == p) {
                out.push(p.to_string());
            }
        }
        out
    }
}

pub fn parse_config(json: &str) -> Result<FactoryConfig, String> {
    serde_json::from_str::<FactoryConfig>(json)
        .map_err(|e| format!("invalid {}: {}", CONFIG_REL_PATH, e))?
        .validated()
}

pub fn config_path(repo_root: &Path) -> PathBuf {
    repo_root.join(CONFIG_REL_PATH)
}

/// Reads the config. A missing file yields the defaults and `exists = false`; an
/// unreadable or invalid file is an error.
pub fn load_config(repo_root: &Path) -> Result<(FactoryConfig, bool), String> {
    load_config_pinned(repo_root).map(|l| (l.config, l.sha256.is_some()))
}

/// A config together with the SHA-256 of the exact bytes it was parsed from, so the
/// approval check and the commands that run always refer to the same file contents.
pub struct LoadedConfig {
    pub config: FactoryConfig,
    /// `None` when the file does not exist (the defaults run no commands).
    pub sha256: Option<String>,
}

pub fn load_config_pinned(repo_root: &Path) -> Result<LoadedConfig, String> {
    let path = config_path(repo_root);
    match fs::read(&path) {
        Ok(bytes) => {
            let raw = String::from_utf8(bytes.clone())
                .map_err(|_| format!("{} is not UTF-8", path.display()))?;
            Ok(LoadedConfig {
                config: parse_config(&raw)?,
                sha256: Some(sha256_hex(&bytes)),
            })
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(LoadedConfig {
            config: FactoryConfig::default(),
            sha256: None,
        }),
        Err(e) => Err(format!("cannot read {}: {}", path.display(), e)),
    }
}

/// The reason commands may not run, or `None` when they may: an existing config
/// must match the hash the operator approved for this repository.
pub fn unapproved_reason(loaded: &LoadedConfig, approved: Option<&str>) -> Option<String> {
    let sha = loaded.sha256.as_deref()?;
    match approved {
        Some(a) if a == sha => None,
        Some(_) => Some(format!(
            "{} changed since it was approved; review and approve it in Factory config before its commands run",
            CONFIG_REL_PATH
        )),
        None => Some(format!(
            "{} has not been approved; review and approve it in Factory config before its commands run",
            CONFIG_REL_PATH
        )),
    }
}

/// Validates and writes the config through a temp file and rename. Returns the
/// SHA-256 of the bytes written.
pub fn save_config(repo_root: &Path, config: FactoryConfig) -> Result<String, String> {
    let config = config.validated()?;
    let path = config_path(repo_root);
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| format!("cannot create {}: {}", dir.display(), e))?;
    }
    let mut body = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    body.push('\n');
    let sha = sha256_hex(body.as_bytes());
    let tmp = path.with_extension(format!("json.tmp-{}", uuid::Uuid::new_v4().simple()));
    fs::write(&tmp, body).map_err(|e| format!("cannot write {}: {}", tmp.display(), e))?;
    fs::rename(&tmp, &path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("cannot replace {}: {}", path.display(), e)
    })?;
    Ok(sha)
}

/// Returns the out-of-scope phrase the text contains, if any (case-insensitive,
/// whole phrase). Deliberately literal: no keyword guessing.
pub fn find_scope_drift<'a>(config: &'a FactoryConfig, text: &str) -> Option<&'a str> {
    let lower = text.to_lowercase();
    config
        .out_of_scope
        .iter()
        .find(|rule| lower.contains(&rule.to_lowercase()))
        .map(String::as_str)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_object_gives_defaults() {
        let cfg = parse_config("{}").unwrap();
        assert_eq!(cfg, FactoryConfig::default());
        assert!(cfg.effective_protected().contains(&".machina/factory.json".to_string()));
    }

    #[test]
    fn rejects_bad_configs() {
        assert!(parse_config(r#"{"tier1":[{"name":"","run":"x"}]}"#).is_err());
        assert!(parse_config(r#"{"tier1":[{"name":"a","run":"  "}]}"#).is_err());
        assert!(parse_config(r#"{"tier1":[{"name":"a","run":"x"},{"name":"A","run":"y"}]}"#).is_err());
        assert!(parse_config(r#"{"timeoutSec":1}"#).is_err());
        assert!(parse_config(r#"{"protectedPaths":["../x"]}"#).is_err());
        assert!(parse_config(r#"{"version":2}"#).is_err());
        assert!(parse_config(r#"{"tierOne":[]}"#).is_err());
    }

    #[test]
    fn commands_need_the_approved_hash() {
        let missing = LoadedConfig { config: FactoryConfig::default(), sha256: None };
        assert!(unapproved_reason(&missing, None).is_none());
        let present = LoadedConfig { config: FactoryConfig::default(), sha256: Some("abc".to_string()) };
        assert!(unapproved_reason(&present, None).unwrap().contains("not been approved"));
        assert!(unapproved_reason(&present, Some("old")).unwrap().contains("changed"));
        assert!(unapproved_reason(&present, Some("abc")).is_none());
    }

    #[test]
    fn scope_drift_is_literal_phrase_match() {
        let cfg = parse_config(r#"{"outOfScope":["cloud sync","Billing"]}"#).unwrap();
        assert_eq!(find_scope_drift(&cfg, "Add Cloud Sync for settings"), Some("cloud sync"));
        assert_eq!(find_scope_drift(&cfg, "billing page"), Some("Billing"));
        assert_eq!(find_scope_drift(&cfg, "Fix the cloud icon"), None);
    }
}
