//! The surface tools' approval in an OpenCode terminal: one allow rule per tool, in the
//! configuration Quay adds. OpenCode reads that configuration after the operator's files, and a
//! rule in it wins over theirs, a denial included, so a tool the operator denies gets none.

use std::ffi::OsString;
use std::path::{Path, PathBuf};

use serde_json::{json, Map, Value};

use super::jsonc;

/// The largest configuration file that is read.
const LARGEST_FILE: u64 = 1024 * 1024;

/// What OpenCode reads its configuration from, in one terminal.
pub struct Surroundings<'a> {
    /// The folder the terminal runs in.
    pub project: &'a Path,
    pub home: Option<&'a Path>,
    /// A variable of the terminal's environment.
    pub var: &'a dyn Fn(&str) -> Option<OsString>,
    /// The terminal's `OPENCODE_CONFIG_CONTENT` before Quay's own.
    pub content: Option<&'a str>,
}

/// Those of `tools`, Quay's tools by name, that nothing in the operator's configuration denies.
/// Configuration that can't be read might deny any of them, so then there are none, and the log says
/// why. An organization's configuration that OpenCode fetches is not looked at.
pub fn not_denied(tools: &'static [&'static str], at: &Surroundings) -> Vec<&'static str> {
    let configs = match operators_configs(at) {
        Ok(configs) => configs,
        Err(e) => {
            tracing::warn!("Letting OpenCode ask before each of Quay's tools: can't read {}", e);
            return Vec::new();
        }
    };
    tools.iter().copied().filter(|tool| !configs.iter().any(|config| denies(config, tool))).collect()
}

/// Adds an allow rule for each of `tools`, Quay's tools by name, to `config`, after its own rules
/// since OpenCode follows the last that fits. A `permission` that is one word is its rule for
/// every tool; one that is neither that nor a list of rules is left alone.
pub fn add_allow_rules(config: &mut Value, tools: &[&str]) {
    if tools.is_empty() {
        return;
    }
    let permission = &mut config["permission"];
    match permission {
        Value::Null => *permission = json!({}),
        Value::String(_) => *permission = json!({ "*": permission.clone() }),
        _ => {}
    }
    let Some(rules) = permission.as_object_mut() else {
        return;
    };
    for tool in tools {
        let name = opencode_name(tool);
        // Taken out first: a rule that is replaced keeps its place
        rules.shift_remove(&name);
        rules.insert(name, json!("allow"));
    }
}

/// What OpenCode calls Quay's tool `tool`: the server's name, then the tool's.
fn opencode_name(tool: &str) -> String {
    format!("quay_{tool}")
}

/// Every configuration of the operator's there is, or which of them can't be read and why.
fn operators_configs(at: &Surroundings) -> Result<Vec<Map<String, Value>>, String> {
    let mut configs = Vec::new();
    for file in config_files(at) {
        let in_file = |e: String| format!("{}: {}", file.display(), e);
        if let Some(text) = read(&file).map_err(in_file)? {
            configs.push(jsonc::object(&text).map_err(in_file)?);
        }
    }
    if let Some(content) = at.content.filter(|content| !content.is_empty()) {
        configs.push(jsonc::object(content).map_err(|e| format!("OPENCODE_CONFIG_CONTENT: {}", e))?);
    }
    if let Some(permission) = non_empty_var(at, "OPENCODE_PERMISSION") {
        let rules = jsonc::object(&permission.to_string_lossy())
            .map_err(|e| format!("OPENCODE_PERMISSION: {}", e))?;
        configs.push(Map::from_iter([("permission".to_string(), Value::Object(rules))]));
    }
    Ok(configs)
}

/// Every file OpenCode 1.x may read its configuration from, whether or not it is there. Those of
/// the project are looked for from its folder up to its repository's root.
fn config_files(at: &Surroundings) -> Vec<PathBuf> {
    const NAMES: [&str; 2] = ["opencode.json", "opencode.jsonc"];
    let mut files: Vec<PathBuf> = Vec::new();
    let mut folder = |dir: PathBuf| files.extend(NAMES.map(|name| dir.join(name)));

    let global = non_empty_var(at, "XDG_CONFIG_HOME").map(PathBuf::from).or_else(|| Some(at.home?.join(".config")));
    if let Some(global) = &global {
        folder(global.join("opencode"));
    }
    if let Some(home) = at.home {
        folder(home.join(".opencode"));
    }
    if let Some(dir) = non_empty_var(at, "OPENCODE_CONFIG_DIR") {
        folder(dir.into());
    }
    if let Some(managed) = managed_folder(at) {
        folder(managed);
    }
    let project = std::path::absolute(at.project).unwrap_or_else(|_| at.project.to_path_buf());
    for dir in project.ancestors() {
        folder(dir.to_path_buf());
        folder(dir.join(".opencode"));
        if dir.join(".git").exists() {
            break;
        }
    }
    files.extend(global.map(|global| global.join("opencode").join("config.json")));
    files.extend(non_empty_var(at, "OPENCODE_CONFIG").map(PathBuf::from));
    files
}

/// Where an administrator puts OpenCode's configuration.
fn managed_folder(at: &Surroundings) -> Option<PathBuf> {
    if cfg!(windows) {
        Some(PathBuf::from(non_empty_var(at, "ProgramData")?).join("opencode"))
    } else if cfg!(target_os = "macos") {
        Some("/Library/Application Support/opencode".into())
    } else {
        Some("/etc/opencode".into())
    }
}

/// The variable `name` of the terminal's environment, unless it is empty.
fn non_empty_var(at: &Surroundings, name: &str) -> Option<OsString> {
    (at.var)(name).filter(|value| !value.is_empty())
}

/// The text of `file`, or `None` when there is no such file.
fn read(file: &Path) -> Result<Option<String>, String> {
    match std::fs::metadata(file) {
        Ok(found) if found.len() > LARGEST_FILE => Err(format!("it is larger than {} bytes", LARGEST_FILE)),
        Ok(_) => std::fs::read_to_string(file).map(Some).map_err(|e| e.to_string()),
        Err(e) if matches!(e.kind(), std::io::ErrorKind::NotFound | std::io::ErrorKind::NotADirectory) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Whether `config` has a rule that denies Quay's tool `tool`.
fn denies(config: &Map<String, Value>, tool: &str) -> bool {
    let name = opencode_name(tool);
    let by_rule = match config.get("permission") {
        None | Some(Value::Null) => false,
        Some(Value::Object(rules)) => rules.iter().any(|(pattern, rule)| fits(pattern, &name) && is_denial(rule)),
        Some(word) => is_denial(word),
    };
    // What `permission` was before it, which OpenCode still reads
    let by_list = config
        .get("tools")
        .and_then(Value::as_object)
        .is_some_and(|tools| tools.iter().any(|(pattern, on)| fits(pattern, &name) && *on != Value::Bool(true)));
    by_rule || by_list
}

/// Whether `rule` denies, or is none that OpenCode 1.x is known to take and so might.
fn is_denial(rule: &Value) -> bool {
    match rule {
        Value::String(word) => word != "allow" && word != "ask",
        Value::Object(rules) => rules.values().any(is_denial),
        _ => true,
    }
}

/// Whether OpenCode's `pattern` fits `name`: `*` is any characters and `?` is one, in any case.
fn fits(pattern: &str, name: &str) -> bool {
    let (pattern, name) = (pattern.as_bytes(), name.as_bytes());
    // Where to take up again when the rest doesn't fit: after the last `*`, one character on
    let (mut p, mut n, mut star) = (0, 0, None);
    while n < name.len() {
        match pattern.get(p) {
            Some(b'*') => {
                star = Some((p + 1, n));
                p += 1;
            }
            Some(&byte) if byte == b'?' || byte.eq_ignore_ascii_case(&name[n]) => {
                p += 1;
                n += 1;
            }
            _ => match star {
                Some((after, at)) => {
                    star = Some((after, at + 1));
                    p = after;
                    n = at + 1;
                }
                None => return false,
            },
        }
    }
    pattern[p..].iter().all(|&byte| byte == b'*')
}
