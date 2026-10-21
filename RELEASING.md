# Quay 2 — Release & Auto-Update Guide

This document outlines the end-to-end process for packaging, cryptographically signing, publishing, and auto-updating Quay across Windows, macOS, and Linux.

---

## Architecture Overview

Quay 2 uses **Tauri v2's native updater** coupled with GitHub Releases:
* **CI/CD Pipeline**: GitHub Actions matrix builds Windows, macOS, and Linux distributables simultaneously via `.github/workflows/release.yml`.
* **Cryptographic Verification**: Release artifacts are signed using Minisign Ed25519 keys. The client verifies signatures before applying any update.
* **Auto-Update Delivery**: An automated `latest.json` manifest is produced during release. Installed Quay clients discover updates in the background or on-demand, prompting the user for approval before downloading, installing, and restarting.

---

## 1. One-Time Setup: Signing Key and GitHub Secrets

Update bundles are signed with a Minisign key pair. The public key is committed in `src-tauri/tauri.conf.json` as `plugins.updater.pubkey`, and an installed Quay accepts only updates signed by the matching private key. The private key and its password never go in the repository. They are kept by the maintainer and stored in two GitHub Actions secrets.

The secrets `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` are already set. Repeat these steps only to set up a new key pair:

1. Generate the key pair outside the repository, and choose a password when asked:
   ```powershell
   pnpm tauri signer generate -w "$env:USERPROFILE\.tauri\quay2-updater.key"
   ```
   This writes the private key to `quay2-updater.key` and the public key to `quay2-updater.key.pub`.
2. Store the private key and its password in a password manager. Without them, no further update can be signed for installed copies.
3. Add both as repository secrets. The second command prompts for the password:
   ```powershell
   Get-Content "$env:USERPROFILE\.tauri\quay2-updater.key" -Raw | gh secret set TAURI_SIGNING_PRIVATE_KEY
   gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD
   ```
4. Copy the contents of `quay2-updater.key.pub` into `plugins.updater.pubkey` in `src-tauri/tauri.conf.json`, and commit it.

> [!WARNING]
> An installed copy checks updates against the public key it was built with. Once a release has shipped with a public key, the release that switches to a new key must still be signed with the old private key.
>
> The key pair that appeared in this file before v0.2.0 is retired. It was published in the repository, and no release was ever signed with it.

---

## 2. Release Steps

### Step 1: Version Bumping
Synchronize the new version number (e.g., `0.2.0`) across project metadata files:

1. `package.json`:
   ```json
   "version": "0.2.0"
   ```
2. `src-tauri/tauri.conf.json`:
   ```json
   "version": "0.2.0"
   ```
3. `src-tauri/Cargo.toml`:
   ```toml
   [package]
   version = "0.2.0"
   ```
4. `src/slices/updater/updaterService.ts`:
   ```ts
   export const APP_CURRENT_VERSION = "0.2.0";
   ```

### Step 2: Commit & Tag

Commit the version bump and push the git release tag:

```powershell
# 1. Commit version bumps
git add -A
git commit -m "chore(release): bump version to v0.2.0"
git push origin master

# 2. Tag and push release
git tag v0.2.0
git push origin v0.2.0
```

#### Alternative: Manual Workflow Dispatch
You can also launch a release without creating a local git tag:
1. Open **[GitHub Actions → Release Builds](https://github.com/seanrobertwright/Quay-2/actions/workflows/release.yml)**.
2. Click **Run workflow**.
3. Enter the tag name (e.g., `v0.2.0`) and branch `master`.
4. Click **Run workflow**.

---

### Step 3: Automated CI Build & Publishing

The workflow `.github/workflows/release.yml` will automatically:
1. Check out code and install Node 20, pnpm, Rust stable, and platform webkit/indicator libraries.
2. Build distributable bundles for:
   * **Windows**: `Quay_0.2.0_x64-setup.exe` (NSIS) and `Quay_0.2.0_x64_en-US.msi`
   * **macOS** (Apple silicon): `Quay_0.2.0_aarch64.dmg` and `Quay_aarch64.app.tar.gz`
   * **Linux**: `Quay_0.2.0_amd64.AppImage`, `Quay_0.2.0_amd64.deb` and `Quay-0.2.0-1.x86_64.rpm`
3. Sign the updater bundles (a `.sig` beside each) and compile the `latest.json` updater manifest.
4. Publish a GitHub Release under **[Releases](https://github.com/seanrobertwright/Quay-2/releases)** with all binaries attached.

### Step 4: Check the Tutorial Captures Before Deploying the Docs

Build the docs with the version being released set in `QUAY_RELEASE_VERSION`:

```powershell
$env:QUAY_RELEASE_VERSION = "0.2.0"; pnpm docs:build; Remove-Item Env:QUAY_RELEASE_VERSION
```

With it set, `docs:build` fails on any tutorial whose sidecar manifest, `examples/tutorials/<slug>/sidecar.json`, does not record that version as `quayVersion`. That catches a tutorial whose screenshots were not recaptured against this release. The variable takes `0.2.0` or `v0.2.0`, and anything else fails the build. Ordinary docs builds leave it unset and skip this check.

---

## 3. How Quay Auto-Updates

Installed Quay clients stay up to date through an opt-in user flow:

### 1. Update Detection
* **Background Startup Check**: 3.5 seconds after Quay launches, it quietly checks `latest.json` (and the GitHub Releases API as fallback).
* **Manual Check**:
  * **Hotkey**: Press `Ctrl+B u` (tmux sequence) at any time.
  * **Command Palette**: Press `Ctrl+K` and type `Check for Updates...`.
  * **Settings**: Open Workspace Settings (`Ctrl+B ,`) and click **Check for Updates**.

### 2. User Consent Modal
When a new version is detected, Quay displays the **Quay Software Update** dialog with:
* Current version vs. New version badge
* Release date
* Full Markdown release notes & changelog
* Two options:
  * **Update & Restart**: Downloads the signed updater payload with a live progress bar, validates cryptographic integrity, unpacks the update, and relaunches Quay seamlessly.
  * **Remind Me Later**: Dismisses the modal without modifying the current installation.
