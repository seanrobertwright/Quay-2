import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { DEFAULT_PREFS, type ToposPrefs, type ToposSettings, type ToposSettingsPatch } from "./toposSettings";

export interface ToposSettingsHandle {
  prefs: ToposPrefs;
  /** Changes one pref at once and hands it to the store, which writes topos.json debounced. */
  setPref: <K extends keyof ToposPrefs>(key: K, value: ToposPrefs[K]) => void;
  /** Records that Topos opened `repoPath`, a repo or worktree, now. */
  recordOpen: (repoPath: string) => void;
}

function write(patch: ToposSettingsPatch): void {
  invoke<ToposSettings>("topos_settings_write", { patch }).catch(console.error);
}

/**
 * Topos's remembered prefs (#384). They read as the defaults until `topos_settings_read` answers,
 * and a pref the operator changes before then keeps the operator's value.
 */
export function useToposSettings(): ToposSettingsHandle {
  const [prefs, setPrefs] = useState<ToposPrefs>(DEFAULT_PREFS);
  const current = useRef(prefs);
  const changed = useRef(new Set<keyof ToposPrefs>());

  useEffect(() => {
    let live = true;
    invoke<ToposSettings>("topos_settings_read")
      .then((stored) => {
        if (!live) return;
        const next = { ...current.current };
        for (const key of Object.keys(DEFAULT_PREFS) as (keyof ToposPrefs)[]) {
          if (!changed.current.has(key)) (next as Record<keyof ToposPrefs, unknown>)[key] = stored[key];
        }
        current.current = next;
        setPrefs(next);
      })
      .catch(console.error);
    return () => {
      live = false;
    };
  }, []);

  const setPref = useCallback(<K extends keyof ToposPrefs>(key: K, value: ToposPrefs[K]) => {
    // A drag reports the same width many times; only a change reaches the store.
    if (current.current[key] === value) return;
    changed.current.add(key);
    current.current = { ...current.current, [key]: value };
    setPrefs(current.current);
    write({ [key]: value });
  }, []);

  const recordOpen = useCallback((repoPath: string) => write({ openedRepo: repoPath }), []);

  return { prefs, setPref, recordOpen };
}
