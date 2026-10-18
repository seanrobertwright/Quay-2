export interface UpdateAsset {
  name: string;
  browser_download_url: string;
  size: number;
  content_type: string;
}

export interface UpdateInfo {
  available: boolean;
  currentVersion: string;
  latestVersion: string;
  releaseName?: string;
  body?: string;
  publishedAt?: string;
  htmlUrl?: string;
  downloadUrl?: string;
  assetName?: string;
  // Raw native Tauri updater update handle if native updater found an update
  rawUpdate?: any;
}

export type UpdatePhase =
  | "idle"
  | "checking"
  | "available"
  | "up-to-date"
  | "downloading"
  | "installing"
  | "ready-to-restart"
  | "error";

export interface UpdateProgress {
  downloaded: number;
  total: number;
  percentage: number;
}
