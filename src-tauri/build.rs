use std::path::{Path, PathBuf};
use std::process::Command;

/// Each sidecar's package, and the name `bundle.externalBin` in `tauri.conf.json` gives it:
/// the Codex turn-end helper and Quay's PiG extension.
const SIDECARS: [(&str, &str); 2] = [
    ("sidecars/codex-notify", "quay-codex-notify"),
    ("sidecars/pig-bridge", "quay-pig-bridge"),
];

/// The package both sidecars post their events with.
const SHARED_PACKAGE: &str = "sidecars/bridge-post";

fn main() {
    let manifest_dir = PathBuf::from(env("CARGO_MANIFEST_DIR"));
    let shared = manifest_dir.join(SHARED_PACKAGE);
    for watched in [shared.join("src"), shared.join("Cargo.toml")] {
        println!("cargo:rerun-if-changed={}", watched.display());
    }
    for (package, name) in SIDECARS {
        build_sidecar(package, name);
    }
    // So a test can find a sidecar built for this target in `binaries/`
    println!("cargo:rustc-env=QUAY_SIDECAR_TARGET={}", env("TARGET"));
    println!("cargo:rustc-env=QUAY_PIG_TESTED_VERSION={}", pig_tested_version(&manifest_dir));
    tauri_build::build()
}

/// Builds the sidecar `package` for this build's target and profile, and puts it where
/// Tauri looks for a sidecar: `binaries/<name>-<target triple>[.exe]`. Tauri then copies it
/// beside the app, as `<name>[.exe]`, in the build folder and in the installer.
fn build_sidecar(package: &str, name: &str) {
    let manifest_dir = PathBuf::from(env("CARGO_MANIFEST_DIR"));
    let package = manifest_dir.join(package);
    let target = env("TARGET");
    let exe_suffix = if target.contains("windows") { ".exe" } else { "" };
    let dest = manifest_dir
        .join("binaries")
        .join(format!("{}-{}{}", name, target, exe_suffix));

    for watched in [package.join("src"), package.join("Cargo.toml"), package.join("Cargo.lock"), dest.clone()] {
        println!("cargo:rerun-if-changed={}", watched.display());
    }

    // A target folder of the sidecars' own, since the app's build holds the lock on the
    // app's. They build one after the other, so they share it and the crates they share.
    let target_dir = PathBuf::from(env("OUT_DIR")).join("sidecars-target");
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
        .unwrap_or_else(|e| panic!("can't run cargo to build {}: {}", name, e));
    assert!(status.success(), "building {} failed", name);

    let built = target_dir
        .join(&target)
        .join(if release { "release" } else { "debug" })
        .join(format!("{}{}", name, exe_suffix));
    copy_if_changed(&built, &dest);
}

/// The PiG version the PiG extension is built against: the tag its `pig-sdk` dependency is
/// pinned to, without the `v`.
fn pig_tested_version(manifest_dir: &Path) -> String {
    let manifest = manifest_dir.join("sidecars/pig-bridge/Cargo.toml");
    println!("cargo:rerun-if-changed={}", manifest.display());
    let text = std::fs::read_to_string(&manifest)
        .unwrap_or_else(|e| panic!("can't read {}: {}", manifest.display(), e));
    text.lines()
        .find(|line| line.starts_with("pig-sdk "))
        .and_then(|line| line.split("tag = \"v").nth(1))
        .and_then(|rest| rest.split('"').next())
        .filter(|version| !version.is_empty() && version.split('.').all(|part| part.parse::<u32>().is_ok()))
        .unwrap_or_else(|| panic!("{} pins pig-sdk to no tag = \"v<major.minor.patch>\"", manifest.display()))
        .to_string()
}

/// Copies `from` to `to`, keeping its permissions, unless `to` already holds the same bytes,
/// so an unchanged sidecar doesn't touch the file the next build watches.
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
