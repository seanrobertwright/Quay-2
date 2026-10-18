# Quay 2 — Release & Auto-Update Guide

This document outlines the end-to-end process for packaging, cryptographically signing, publishing, and auto-updating Quay across Windows, macOS, and Linux.

---

## Architecture Overview

Quay 2 uses **Tauri v2's native updater** coupled with GitHub Releases:
* **CI/CD Pipeline**: GitHub Actions matrix builds Windows, macOS, and Linux distributables simultaneously via `.github/workflows/release.yml`.
* **Cryptographic Verification**: Release artifacts are signed using Minisign Ed25519 keys. The client verifies signatures before applying any update.
* **Auto-Update Delivery**: An automated `latest.json` manifest is produced during release. Installed Quay clients discover updates in the background or on-demand, prompting the user for approval before downloading, installing, and restarting.

---

## 1. One-Time Setup: GitHub Actions Signing Secret

To allow GitHub Actions to sign update bundles and output `latest.json`, add the Minisign private key to GitHub Secrets:

1. Navigate to: **[GitHub Repository Settings → Secrets and variables → Actions](https://github.com/seanrobertwright/Quay-2/settings/secrets/actions)**
2. Click **New repository secret**.
3. **Name**: `TAURI_SIGNING_PRIVATE_KEY`
4. **Secret Value**:
   ```text
   dW50cnVzdGVkIGNvbW1lbnQ6IHJzaWduIGVuY3J5cHRlZCBzZWNyZXQga2V5ClJXUlRZMEl5R00yaG1pTHBTblR4RWhaem5tSzVyL1B2SmJ1ZllnNmFJUHlObWh5bWtpY0FBQkFBQUFBQUFBQUFBQUlBQUFBQXVVRjZHWThKT3FVNDhEUi9sTk56dmY2T0tMNE1tVWM2Vlp4SXhacDRDL1V2Qnh0QWZFR1JxWk1UVG9wcHh4UG10d1lUNFBCWmNiV3hMdVJCVFhBdzIrNk1GY3FCdUsvVGNGR0YrTmVyZnYzQ0Y0TUhNb3J0eC9hV3RRTXowSGpnVDg0eVo0UGkvVms9Cg==
   ```
5. Click **Add secret**.

> [!NOTE]
> The matching public key is already hardcoded and committed in `src-tauri/tauri.conf.json`:
> ```text
> dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDUxMDYwNDFBQUVFQzEzMDUKUldRRkUreXVHZ1FHVVhvNlhVRzc2N1NhVlRUb1hYL050TEhIRVFFYk9vYm1lQlQrZytWN0VQSU0K
> ```

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
   * **Windows**: `Quay_0.2.0_x64-setup.exe` (NSIS) and `.msi`
   * **macOS**: `Quay_0.2.0_universal.dmg` and `.app`
   * **Linux**: `quay_0.2.0_amd64.AppImage` and `.deb`
3. Sign packages and compile the `latest.json` updater manifest.
4. Publish a GitHub Release under **[Releases](https://github.com/seanrobertwright/Quay-2/releases)** with all binaries attached.

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
