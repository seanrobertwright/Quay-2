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

### Step 3: Automated CI Build & Draft Release

The workflow `.github/workflows/release.yml` will automatically:
1. Check out code and install Node 20, pnpm, Rust stable, and platform webkit/indicator libraries.
2. Build distributable bundles for:
   * **Windows**: `Quay_0.2.0_x64-setup.exe` (NSIS) and `Quay_0.2.0_x64_en-US.msi`
   * **macOS** (Apple silicon): `Quay_0.2.0_aarch64.dmg` and `Quay_aarch64.app.tar.gz`
   * **Linux**: `Quay_0.2.0_amd64.AppImage`, `Quay_0.2.0_amd64.deb` and `Quay-0.2.0-1.x86_64.rpm`
3. Sign the updater bundles (a `.sig` beside each) and compile the `latest.json` updater manifest.
4. Create a **draft** GitHub Release under **[Releases](https://github.com/seanrobertwright/Quay-2/releases)** with all binaries attached.

A draft is not published. Only people with write access to the repository see it, and installed copies don't update to it: the updater reads `releases/latest/download/latest.json`, and GitHub's latest release is never a draft. The draft waits for the steps below.

### Step 4: Recapture, Re-run, Then Publish

Do these in order at every draft release. The order comes from the decisions on [keeping screenshots current](https://github.com/seanrobertwright/Quay-2/issues/15) and on [tutorial test runs](https://github.com/seanrobertwright/Quay-2/issues/14).

Steps 1 to 3 cover the tutorials published on `master`. While none is, steps 1 to 3 have nothing to do and step 5 has no branch of new shots to merge: publish the draft. A tutorial still on its branch isn't recaptured here. Its own test runs and capture use the published release's installer, and a tutorial that needs a change in Quay waits for the release that holds it.

1. **Recapture every tutorial against the draft.** On the capture machine, install Quay from the draft's Windows installer, downloaded from the draft's page under Releases. Then run the capture script for each tutorial with a capture manifest, `tools/record-replay/recordings/<slug>/capture.json`, with `--exe` set to the Quay the installer put in place:

   ```powershell
   pnpm docs:capture <slug> --exe <installed Quay exe>
   ```

   `scripts/capture/README.md` describes the capture machine and the script. Each capture writes the tutorial's stills beside its page, its sidecar manifest, and its section of the release's changed-shot report in `capture-reports/<version>/`.
2. **Review the changed shots.** Open `capture-reports/<version>/index.html`. It lists the tutorials with changed or new shots and shows each changed shot's committed image beside its new one. A shot that changed for no reason the release explains is a regression to chase before publishing. Commit the new stills and sidecars on a branch, not on `master`: a push to `master` that touches `docs/` or `examples/` deploys the docs, and the docs wait for the release.
3. **Re-run the affected tutorials on the draft.** Re-run each tutorial the report lists, plus any tutorial that uses a feature the release notes name. Write the release notes in the draft first, so that list is known. Each re-run is a test run as `scripts/test-runs/README.md` describes, with Quay installed from the draft's installer.
4. **Publish the release.** Open the draft under Releases and publish it. Installed copies now see the update.
5. **Deploy the docs.** On the branch with the new shots, build the docs with the version being released set in `QUAY_RELEASE_VERSION`:

   ```powershell
   $env:QUAY_RELEASE_VERSION = "0.2.0"; pnpm docs:build; Remove-Item Env:QUAY_RELEASE_VERSION
   ```

   With it set, `docs:build` fails on any tutorial whose sidecar manifest, `examples/tutorials/<slug>/sidecar.json`, does not record that version as `quayVersion`. That catches a tutorial whose screenshots were not recaptured against this release. The variable takes `0.2.0` or `v0.2.0`, and anything else fails the build. Ordinary docs builds leave it unset and skip this check.

   Once it passes, merge the branch with the new shots into `master`, with any tutorial branch that holds a re-run's record or a fix. The **Deploy Documentation to GitHub Pages** workflow deploys the site from that push.

#### When a re-run fails on the draft

A failed re-run holds the release. The draft stays unpublished until the app or the tutorial is fixed.

* **The app is at fault.** Fix it on `master`, then replace the draft. Delete the draft and its tag, tag the fixed commit, and push the tag:

  ```powershell
  gh release delete v0.2.0 --cleanup-tag --yes
  git fetch origin
  git tag -f v0.2.0 origin/master
  git push origin v0.2.0
  ```

  The workflow builds a new draft. Start again from recapture, since the fix can change what a screenshot shows.
* **The tutorial is at fault.** Fix it on the tutorial's branch. A fix that changes the tutorial's run fingerprint needs two passing runs, not one. The fix merges when the release is published.

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
