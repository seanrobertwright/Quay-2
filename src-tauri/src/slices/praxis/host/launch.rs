//! Finding `praxis` (#228). Quay never starts it through npm's `praxis.cmd` shim or `cmd.exe`,
//! the same rule PiG's terminals follow: it follows npm's global `node_modules/@aiws/engine`
//! link into the AI-WS-SDK checkout, reads `bin.praxis` from that package's `package.json`, and
//! runs `node <script> <args>`, once `node --version` says 24 or later.

use std::ffi::OsString;
use std::path::{Path, PathBuf};

use serde_json::Value;

/// The npm package that carries the `praxis` bin, as a path under `node_modules`.
const PACKAGE: [&str; 2] = ["@aiws", "engine"];

/// The oldest Node major version `praxis` runs on (`engines.node` in its package).
pub const MIN_NODE_MAJOR: u32 = 24;

/// How to start `praxis`: `node <script>`, then its arguments.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Launch {
    pub node: PathBuf,
    pub script: PathBuf,
}

/// What locating `praxis` reads from Quay's environment.
#[derive(Debug, Clone, Default)]
pub struct LookupEnv {
    pub path: Option<OsString>,
    /// `%APPDATA%`, under which npm keeps its default global prefix on Windows.
    pub appdata: Option<PathBuf>,
    /// `NPM_CONFIG_PREFIX`, when the user moved npm's global prefix.
    pub npm_prefix: Option<PathBuf>,
}

impl LookupEnv {
    pub fn from_process() -> Self {
        Self {
            path: std::env::var_os("PATH"),
            appdata: std::env::var_os("APPDATA").map(PathBuf::from),
            npm_prefix: std::env::var_os("NPM_CONFIG_PREFIX").map(PathBuf::from),
        }
    }
}

/// The message for a machine where `praxis` isn't linked.
pub fn not_linked() -> String {
    "The praxis CLI isn't linked. In your AI-WS-SDK checkout, run `npm link` in its engine folder, \
     or name the checkout in Quay's Praxis settings."
        .to_string()
}

/// The `praxis` script of the package in `dir`: its `package.json`'s `bin.praxis`, which must be
/// a file inside the package. `None` when `dir` has no `package.json`.
fn script_in_package(dir: &Path) -> Result<Option<PathBuf>, String> {
    let manifest = dir.join("package.json");
    let text = match std::fs::read_to_string(&manifest) {
        Ok(text) => text,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("Couldn't read {}: {}", manifest.display(), e)),
    };
    let package: Value = serde_json::from_str(&text).map_err(|_| format!("{} isn't valid JSON.", manifest.display()))?;
    let Some(bin) = package.pointer("/bin/praxis").and_then(Value::as_str) else {
        return Ok(None);
    };
    let root = dir.canonicalize().map_err(|e| format!("Couldn't open {}: {}", dir.display(), e))?;
    let script = root.join(bin).canonicalize().map_err(|_| format!("{} names a praxis script, {bin}, that isn't there.", manifest.display()))?;
    if !script.starts_with(&root) || !script.is_file() {
        return Err(format!("{} names a praxis script, {bin}, outside its package.", manifest.display()));
    }
    // Node can't load a script by the `\\?\` path a canonical Windows path carries.
    Ok(Some(PathBuf::from(crate::slices::praxis::store::display_path(&script)?)))
}

/// The `praxis` script in an AI-WS-SDK checkout: its `engine` package's, or, when `dir` is that
/// package itself, its own.
pub fn script_in_checkout(dir: &Path) -> Result<PathBuf, String> {
    for package in [dir.join("engine"), dir.to_path_buf()] {
        if let Some(script) = script_in_package(&package)? {
            return Ok(script);
        }
    }
    Err(format!("{} isn't an AI-WS-SDK checkout: neither it nor its engine folder has a package.json with a praxis bin.", dir.display()))
}

/// The folders npm's global link for `@aiws/engine` can be in, most likely first: beside each
/// `praxis` shim on `PATH`, under `NPM_CONFIG_PREFIX`, and under npm's default prefix.
fn linked_packages(env: &LookupEnv) -> Vec<PathBuf> {
    let package = |modules: PathBuf| PACKAGE.iter().fold(modules, |dir, part| dir.join(part));
    // On Windows npm puts its shims in the prefix and packages in `<prefix>/node_modules`;
    // elsewhere shims go in `<prefix>/bin` and packages in `<prefix>/lib/node_modules`.
    let modules_of = |prefix: &Path| {
        if cfg!(windows) { prefix.join("node_modules") } else { prefix.join("lib").join("node_modules") }
    };
    let shim = if cfg!(windows) { "praxis.cmd" } else { "praxis" };
    let mut out = Vec::new();
    if let Some(path) = &env.path {
        for dir in std::env::split_paths(path).filter(|dir| dir.is_absolute() && dir.join(shim).is_file()) {
            let prefix = if cfg!(windows) { Some(dir.clone()) } else { dir.parent().map(Path::to_path_buf) };
            if let Some(prefix) = prefix {
                out.push(package(modules_of(&prefix)));
            }
        }
    }
    if let Some(prefix) = env.npm_prefix.as_ref().filter(|p| p.is_absolute()) {
        out.push(package(modules_of(prefix)));
    }
    if cfg!(windows)
        && let Some(appdata) = env.appdata.as_ref().filter(|p| p.is_absolute())
    {
        out.push(package(appdata.join("npm").join("node_modules")));
    }
    out
}

/// The `praxis` script: the configured checkout's when there is one, or else the one npm's
/// global link points at.
pub fn find_script(checkout_script: Option<&Path>, env: &LookupEnv) -> Result<PathBuf, String> {
    if let Some(script) = checkout_script {
        return Ok(script.to_path_buf());
    }
    for package in linked_packages(env) {
        if let Some(script) = script_in_package(&package)? {
            return Ok(script);
        }
    }
    Err(not_linked())
}

/// The first `node` executable in an absolute folder on `PATH`.
pub fn find_node(env: &LookupEnv) -> Result<PathBuf, String> {
    let name = if cfg!(windows) { "node.exe" } else { "node" };
    env.path
        .as_ref()
        .and_then(|path| std::env::split_paths(path).filter(|dir| dir.is_absolute()).map(|dir| dir.join(name)).find(|p| p.is_file()))
        .ok_or_else(|| format!("praxis needs Node {MIN_NODE_MAJOR} or later, and there is no node on PATH."))
}

/// The major version in `node --version`'s output, such as 24 from `v24.20.0`.
pub fn node_major(version: &str) -> Option<u32> {
    let rest = version.trim().strip_prefix('v')?;
    let major = rest.split('.').next()?;
    if major.is_empty() || !major.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    major.parse().ok()
}

/// Refuses a Node older than [`MIN_NODE_MAJOR`], given `node --version`'s output.
pub fn check_node_version(version: &str) -> Result<(), String> {
    match node_major(version) {
        Some(major) if major >= MIN_NODE_MAJOR => Ok(()),
        Some(_) => Err(format!(
            "praxis needs Node {MIN_NODE_MAJOR} or later, and the node on PATH is {}. Install a newer Node.",
            version.trim()
        )),
        None => Err(format!("Quay couldn't read the Node version from {:?}.", version.trim())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("quay-praxis-launch-{tag}-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&dir).unwrap();
        PathBuf::from(crate::slices::praxis::store::display_path(&dir.canonicalize().unwrap()).unwrap())
    }

    fn package(dir: &Path, bin: &str) {
        std::fs::create_dir_all(dir.join("src")).unwrap();
        std::fs::write(dir.join("src").join("praxis.ts"), "").unwrap();
        std::fs::write(dir.join("package.json"), format!(r#"{{"name":"@aiws/engine","bin":{{"praxis":"{bin}"}}}}"#)).unwrap();
    }

    #[test]
    fn a_checkout_resolves_to_its_engine_packages_bin() {
        let root = temp_dir("checkout");
        std::fs::write(root.join("package.json"), r#"{"name":"aiws-sdk-workspace"}"#).unwrap();
        package(&root.join("engine"), "src/praxis.ts");
        assert_eq!(script_in_checkout(&root).unwrap(), root.join("engine").join("src").join("praxis.ts"));
        // The engine package itself is accepted as the checkout.
        assert_eq!(script_in_checkout(&root.join("engine")).unwrap(), root.join("engine").join("src").join("praxis.ts"));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn a_folder_without_a_praxis_bin_is_refused() {
        let root = temp_dir("not-sdk");
        std::fs::write(root.join("package.json"), r#"{"name":"other","bin":{"other":"x.js"}}"#).unwrap();
        assert!(script_in_checkout(&root).unwrap_err().contains("isn't an AI-WS-SDK checkout"));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn a_bin_outside_its_package_is_refused() {
        let root = temp_dir("escape");
        std::fs::write(root.join("outside.ts"), "").unwrap();
        package(&root.join("engine"), "../outside.ts");
        assert!(script_in_checkout(&root).unwrap_err().contains("outside its package"));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn the_global_link_is_found_beside_the_shim_on_path_never_the_shim_itself() {
        let prefix = temp_dir("prefix");
        let (shim_dir, modules) = if cfg!(windows) {
            (prefix.clone(), prefix.join("node_modules"))
        } else {
            (prefix.join("bin"), prefix.join("lib").join("node_modules"))
        };
        std::fs::create_dir_all(&shim_dir).unwrap();
        std::fs::write(shim_dir.join(if cfg!(windows) { "praxis.cmd" } else { "praxis" }), "").unwrap();
        package(&modules.join("@aiws").join("engine"), "src/praxis.ts");
        let env = LookupEnv { path: Some(std::env::join_paths([shim_dir.clone()]).unwrap()), ..LookupEnv::default() };
        let script = find_script(None, &env).unwrap();
        assert_eq!(script, modules.join("@aiws").join("engine").join("src").join("praxis.ts"));
        let _ = std::fs::remove_dir_all(prefix);
    }

    #[test]
    fn a_configured_checkout_wins_and_no_link_says_how_to_link() {
        let elsewhere = PathBuf::from("/configured/praxis.ts");
        assert_eq!(find_script(Some(&elsewhere), &LookupEnv::default()).unwrap(), elsewhere);
        assert_eq!(find_script(None, &LookupEnv::default()).unwrap_err(), not_linked());
    }

    #[test]
    fn node_24_or_later_is_required() {
        assert_eq!(node_major("v24.20.0\n"), Some(24));
        assert_eq!(node_major("v100.0.0"), Some(100));
        assert_eq!(node_major("24.0.0"), None);
        assert_eq!(node_major("v.1"), None);
        assert!(check_node_version("v24.0.0").is_ok());
        assert!(check_node_version("v25.1.0").is_ok());
        assert!(check_node_version("v22.11.0").unwrap_err().contains("Node 24 or later"));
        assert!(check_node_version("garbage").unwrap_err().contains("couldn't read"));
    }
}
