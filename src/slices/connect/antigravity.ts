// Whether Antigravity is connected to Quay (#732): what Rust read in its configuration file, the
// offer to connect it again at launch, and the note in a terminal that is not connected. Only
// `connectAntigravity` and `removeAntigravity` have Rust write, and only the Connect row calls them.
import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { dismissShellWarning, showShellWarning } from "../stage/shellWarnings.ts";
import type { AntigravityConnection } from "./connectTypes.ts";

/** The shell-wide warning's id. */
const WARNING_ID = "connect-antigravity";

// Both in the WebView's `localStorage`, so per machine.
/** Set while Antigravity was last known to have an entry. */
const HAD_ENTRY_KEY = "quay_antigravity_had_entry";
/** Set once a terminal has said that Antigravity is not connected. */
const NOTE_SAID_KEY = "quay_antigravity_note_said";

// What was last read, and the terminal whose note is up.
let connection: AntigravityConnection | null = null;
let noteTerminal: string | null = null;
// Counts reads and writes as they start, so that one that ends late replaces nothing newer.
let newest = 0;
const listeners = new Set<() => void>();

function changed(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Where the entry stands, or null before the first read and in a build that offers no surfaces. */
export function useAntigravity(): AntigravityConnection | null {
  return useSyncExternalStore(subscribe, () => connection);
}

/** The terminal whose note is up, or null. */
export function useNoteTerminal(): string | null {
  return useSyncExternalStore(subscribe, () => noteTerminal);
}

/** Drops what was read and takes the note down, as a window that loads again does. */
export function forgetAntigravity(): void {
  newest += 1;
  connection = null;
  noteTerminal = null;
  changed();
}

function take(read: AntigravityConnection | null): void {
  connection = read;
  if (read && read.state !== "missing" && read.state !== "unreadable") {
    window.localStorage.setItem(HAD_ENTRY_KEY, "1");
    noteTerminal = null;
  }
  changed();
}

/** Reads where the entry stands. Returns null when that can't be read, and never rejects. */
export async function readAntigravity(): Promise<AntigravityConnection | null> {
  const mine = (newest += 1);
  try {
    const read = await invoke<AntigravityConnection | null>("antigravity_connection");
    if (mine === newest) take(read);
    return read;
  } catch (error) {
    console.warn("Could not read whether Antigravity is connected:", error);
    return null;
  }
}

async function write(command: string, seen: string | null): Promise<void> {
  const mine = (newest += 1);
  try {
    const written = await invoke<AntigravityConnection>(command, { seen });
    if (command === "antigravity_remove") window.localStorage.removeItem(HAD_ENTRY_KEY);
    if (mine === newest) take(written);
    // A read that started since may have read the file before it was written
    else await readAntigravity();
    dismissShellWarning(WARNING_ID);
  } catch (error) {
    await readAntigravity();
    throw error;
  }
}

/** Writes the entry in place of `seen`, the one that was shown. Rejects with why it was not written. */
export const connectAntigravity = (seen: string | null): Promise<void> => write("antigravity_connect", seen);

/** Takes out the entry `seen`, the one that was shown. Rejects with why it was not taken out. */
export const removeAntigravity = (seen: string): Promise<void> => write("antigravity_remove", seen);

const ROW_ASKED = "quay:connect-row";

/** Asks the window to open the Connect row in the Project panel. */
export function askForConnectRow(): void {
  window.dispatchEvent(new CustomEvent(ROW_ASKED));
}

/** Calls `handler` each time the Connect row is asked for. Returns a function that stops it. */
export function onConnectRowAsked(handler: () => void): () => void {
  window.addEventListener(ROW_ASKED, handler);
  return () => window.removeEventListener(ROW_ASKED, handler);
}

/**
 * Reads the entry at launch and offers Connect again when it names an old relay, or when it is
 * missing and Antigravity was connected. Never rejects.
 */
export async function offerConnectAgain(): Promise<void> {
  const read = await readAntigravity();
  const gone = read?.state === "missing" && window.localStorage.getItem(HAD_ENTRY_KEY) !== null;
  if (!gone && read?.state !== "old_relay") return;
  showShellWarning({
    id: WARNING_ID,
    message: gone ? "Quay's entry is gone from Antigravity's configuration." : "Antigravity starts an old relay, not this Quay's.",
    action: {
      label: "Connect again",
      run: () => {
        dismissShellWarning(WARNING_ID);
        askForConnectRow();
      },
    },
    // An entry the operator took out by hand is not offered at every launch. An old relay is.
    onDismiss: gone ? () => window.localStorage.removeItem(HAD_ENTRY_KEY) : undefined,
  });
}

/**
 * Reads the entry for a terminal of Antigravity that is shown, and has that terminal say that
 * Antigravity is not connected, if it is not. It is said once, on this machine.
 */
export async function sayNotConnected(terminalId: string, stillShown: () => boolean): Promise<void> {
  if (window.localStorage.getItem(NOTE_SAID_KEY) !== null) return;
  const read = await readAntigravity();
  if (read?.state !== "missing" && read?.state !== "unreadable") return;
  // Read again: another terminal may have said it meanwhile
  if (!stillShown() || window.localStorage.getItem(NOTE_SAID_KEY) !== null) return;
  window.localStorage.setItem(NOTE_SAID_KEY, "1");
  noteTerminal = terminalId;
  changed();
}

/** Takes the note down. */
export function dismissNote(): void {
  noteTerminal = null;
  changed();
}
