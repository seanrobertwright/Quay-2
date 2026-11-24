// What Connect's commands return: `src-tauri/src/slices/connect/antigravity.rs`.

/** Where Quay's entry stands in Antigravity's configuration file. */
export type ConnectState = "missing" | "connected" | "old_relay" | "changed" | "unreadable";

export interface AntigravityConnection {
  /** The file's path. */
  file: string;
  /** The entry Connect writes. */
  entry: string;
  state: ConnectState;
  /** The entry that is in the file, as it is written there. */
  found: string | null;
  /** Why the file can't be read or edited. */
  problem: string | null;
}
