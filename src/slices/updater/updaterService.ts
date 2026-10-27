import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { UpdateInfo, UpdateProgress } from "./types";

export const APP_CURRENT_VERSION = "0.5.0";
const GITHUB_REPO = "seanrobertwright/Quay-2";

/**
 * Robust semver comparison (handles v0.1.0 vs 0.1.0, pre-releases, etc.)
 * Returns true if remote is strictly greater than local.
 */
export function isVersionNewer(remote: string, local: string): boolean {
  const clean = (v: string) => v.replace(/^v/i, "").trim();
  const rParts = clean(remote).split("-")[0].split(".").map((n) => parseInt(n, 10) || 0);
  const lParts = clean(local).split("-")[0].split(".").map((n) => parseInt(n, 10) || 0);

  const len = Math.max(rParts.length, lParts.length);
  for (let i = 0; i < len; i++) {
    const r = rParts[i] ?? 0;
    const l = lParts[i] ?? 0;
    if (r > l) return true;
    if (r < l) return false;
  }
  return false;
}

/**
 * Select the best downloadable asset from GitHub release assets based on user platform
 */
function pickBestAsset(assets: any[]): { name: string; url: string } | undefined {
  if (!assets || !assets.length) return undefined;

  const ua = typeof navigator !== "undefined" ? navigator.userAgent.toLowerCase() : "";
  const isWindows = ua.includes("win");
  const isMac = ua.includes("mac");
  const isLinux = ua.includes("linux") && !isWindows && !isMac;

  if (isWindows) {
    const setupExe = assets.find((a) => a.name.endsWith(".exe") && a.name.includes("setup"));
    if (setupExe) return { name: setupExe.name, url: setupExe.browser_download_url };
    const anyExe = assets.find((a) => a.name.endsWith(".exe"));
    if (anyExe) return { name: anyExe.name, url: anyExe.browser_download_url };
    const msi = assets.find((a) => a.name.endsWith(".msi"));
    if (msi) return { name: msi.name, url: msi.browser_download_url };
  } else if (isMac) {
    const dmg = assets.find((a) => a.name.endsWith(".dmg"));
    if (dmg) return { name: dmg.name, url: dmg.browser_download_url };
    const tar = assets.find((a) => a.name.endsWith(".tar.gz") && a.name.includes(".app"));
    if (tar) return { name: tar.name, url: tar.browser_download_url };
  } else if (isLinux) {
    const appImage = assets.find((a) => a.name.endsWith(".AppImage"));
    if (appImage) return { name: appImage.name, url: appImage.browser_download_url };
    const deb = assets.find((a) => a.name.endsWith(".deb"));
    if (deb) return { name: deb.name, url: deb.browser_download_url };
  }

  // Fallback to first non-source asset
  const first = assets[0];
  return first ? { name: first.name, url: first.browser_download_url } : undefined;
}

/**
 * Checks for available updates.
 * Attempts native Tauri updater plugin first (signed binaries).
 * Seamlessly falls back to GitHub Releases API if native manifest is pending or unavailable.
 */
export async function checkForUpdates(): Promise<UpdateInfo> {
  // 1. Try native Tauri updater plugin
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const nativeUpdate = await check();
    if (nativeUpdate) {
      return {
        available: true,
        currentVersion: nativeUpdate.currentVersion || APP_CURRENT_VERSION,
        latestVersion: nativeUpdate.version,
        body: nativeUpdate.body,
        publishedAt: nativeUpdate.date,
        rawUpdate: nativeUpdate,
      };
    }
  } catch (nativeErr) {
    console.warn("Tauri native updater check skipped or unavailable (falling back to GitHub):", nativeErr);
  }

  // 2. Fallback: Query GitHub Releases API
  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
      headers: { Accept: "application/vnd.github.v3+json" },
    });

    if (res.status === 404) {
      return {
        available: false,
        currentVersion: APP_CURRENT_VERSION,
        latestVersion: APP_CURRENT_VERSION,
      };
    }

    if (!res.ok) {
      throw new Error(`GitHub releases API error: HTTP ${res.status}`);
    }

    const data = await res.json();
    const latestVersion = (data.tag_name || "").replace(/^v/i, "");
    const newer = isVersionNewer(latestVersion, APP_CURRENT_VERSION);
    const asset = pickBestAsset(data.assets || []);

    return {
      available: newer,
      currentVersion: APP_CURRENT_VERSION,
      latestVersion,
      releaseName: data.name || data.tag_name,
      body: data.body,
      publishedAt: data.published_at,
      htmlUrl: data.html_url,
      downloadUrl: asset?.url || data.html_url,
      assetName: asset?.name,
    };
  } catch (ghErr) {
    console.error("Failed to check GitHub releases:", ghErr);
    return {
      available: false,
      currentVersion: APP_CURRENT_VERSION,
      latestVersion: APP_CURRENT_VERSION,
    };
  }
}

/**
 * Downloads and applies the update if user agrees.
 * Uses the native download, then saves the terminals' screens, installs and restarts when
 * available; otherwise opens the download link.
 */
export async function applyUpdate(
  update: UpdateInfo,
  onProgress?: (progress: UpdateProgress) => void
): Promise<void> {
  if (update.rawUpdate) {
    let downloaded = 0;
    let contentLength = 0;

    await update.rawUpdate.download((event: any) => {
      switch (event.event) {
        case "Started":
          contentLength = event.data?.contentLength ?? 0;
          onProgress?.({ downloaded: 0, total: contentLength, percentage: 0 });
          break;
        case "Progress":
          downloaded += event.data?.chunkLength ?? 0;
          const pct = contentLength > 0 ? Math.min(100, Math.round((downloaded / contentLength) * 100)) : 50;
          onProgress?.({ downloaded, total: contentLength, percentage: pct });
          break;
        case "Finished":
          onProgress?.({ downloaded: contentLength, total: contentLength, percentage: 100 });
          break;
      }
    });

    // On Windows the installer closes Quay without its exit event, so save each running
    // terminal's screen first. A failed save mustn't stop the update.
    await invoke("save_terminal_screens").catch((err) => {
      console.error("Failed to save terminal screens before the update:", err);
    });
    await update.rawUpdate.install();

    // Relaunch app into new version
    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
  } else if (update.downloadUrl) {
    await openUrl(update.downloadUrl);
  } else if (update.htmlUrl) {
    await openUrl(update.htmlUrl);
  }
}
