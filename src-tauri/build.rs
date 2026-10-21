use std::path::{Path, PathBuf};
use std::process::Command;

/// The Codex turn-end helper's package, and the name `bundle.externalBin` in
/// `tauri.conf.json` gives it.
const SIDECAR_PACKAGE: &str = "sidecars/codex-notify";
const SIDECAR_NAME: &str = "quay-codex-notify";

fn main() {
    build_codex_notify();
    tauri_build::build()
}

/// Builds the Codex turn-end helper for this build's target and profile, and puts it where
/// Tauri looks for a sidecar: `binaries/<name>-<target triple>[.exe]`. Tauri then copies it
/// beside the app, in the build folder and in the installer.
fn build_codex_notify() {
    let manifest_dir = PathBuf::from(env("CARGO_MANIFEST_DIR"));
    let package = manifest_dir.join(SIDECAR_PACKAGE);
    let target = env("TARGET");
    let exe_suffix = if target.contains("windows") { ".exe" } else { "" };
    let dest = manifest_dir
        .join("binaries")
        .join(format!("{}-{}{}", SIDECAR_NAME, target, exe_suffix));

    for watched in [package.join("src"), package.join("Cargo.toml"), package.join("Cargo.lock"), dest.clone()] {
        println!("cargo:rerun-if-changed={}", watched.display());
    }

    // A target folder of its own: the app's build holds the lock on the app's
    let target_dir = PathBuf::from(env("OUT_DIR")).join("codex-notify-target");
    let release = env("PROFILE") == "release";
    let mut cargo = Command::new(env("CARGO"));
    cargo
        .arg("build")
        .arg("--locked")
        .arg("--manifest-path")
        .arg(package.join("Cargo.toml"))
        .arg("--target")
        .arg(&target)
        .arg("--target-dir")
        .arg(&target_dir)
        .env_remove("CARGO_TARGET_DIR");
    if release {
        cargo.arg("--release");
    }
    let status = cargo
        .status()
        .unwrap_or_else(|e| panic!("can't run cargo to build {}: {}", SIDECAR_NAME, e));
    assert!(status.success(), "building {} failed", SIDECAR_NAME);

    let built = target_dir
        .join(&target)
        .join(if release { "release" } else { "debug" })
        .join(format!("{}{}", SIDECAR_NAME, exe_suffix));
    copy_if_changed(&built, &dest);
}

/// Copies `from` to `to`, keeping its permissions, unless `to` already holds the same bytes,
/// so an unchanged helper doesn't touch the file the next build watches.
fn copy_if_changed(from: &Path, to: &Path) {
    let built = std::fs::read(from).unwrap_or_else(|e| panic!("can't read {}: {}", from.display(), e));
    if std::fs::read(to).is_ok_and(|current| current == built) {
        return;
    }
    if let Some(dir) = to.parent() {
        std::fs::create_dir_all(dir).unwrap_or_else(|e| panic!("can't create {}: {}", dir.display(), e));
    }
    std::fs::copy(from, to).unwrap_or_else(|e| panic!("can't write {}: {}", to.display(), e));
}

fn env(name: &str) -> String {
    std::env::var(name).unwrap_or_else(|_| panic!("cargo did not set {}", name))
}
