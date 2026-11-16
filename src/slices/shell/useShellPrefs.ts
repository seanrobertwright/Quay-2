import { useCallback, useState } from "react";
import type { PrefsStorage } from "../companion/companionPrefs.ts";
import { readShellPrefs, writeShellPref, type SetShellPref, type ShellPrefKey, type ShellPrefs } from "./shellPrefs.ts";

/**
 * The shell preferences in `storage` (the WebView's `localStorage` in the app), read once on mount
 * and re-read after each change, so what shows is what a restart would read.
 */
export function useShellPrefs(storage: PrefsStorage): {
  prefs: ShellPrefs;
  setPref: SetShellPref;
} {
  const [prefs, setPrefs] = useState(() => readShellPrefs(storage));
  const setPref = useCallback(
    <K extends ShellPrefKey>(key: K, value: ShellPrefs[K]) => {
      writeShellPref(storage, key, value);
      setPrefs(readShellPrefs(storage));
    },
    [storage]
  );
  return { prefs, setPref };
}
