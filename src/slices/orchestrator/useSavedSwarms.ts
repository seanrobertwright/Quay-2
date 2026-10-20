import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { RUN_KINDS, STAGE_LAYOUTS } from "../terminal/types";
import {
  SavedSwarm,
  SwarmAgentConfig,
  SwarmDraft,
  SwarmPreset,
  sameSwarmName,
  savedSwarmToPreset,
  swarmNameError,
} from "./swarmTypes";

/** Where custom presets lived before swarms.json. Imported once, then deleted. */
const LEGACY_STORAGE_KEY = "quay2_custom_swarm_presets";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const optionalString = (value: unknown) => (typeof value === "string" ? value : undefined);

/** A legacy localStorage entry as a draft the store accepts, or null when it can't be saved. */
const legacyEntryToDraft = (entry: unknown): SwarmDraft | null => {
  if (!isRecord(entry) || typeof entry.title !== "string" || swarmNameError(entry.title)) {
    return null;
  }
  const layout = STAGE_LAYOUTS.find((l) => l === entry.layout);
  if (!layout || !Array.isArray(entry.agents) || entry.agents.length === 0) return null;
  const agents: SwarmAgentConfig[] = [];
  for (const agent of entry.agents) {
    if (!isRecord(agent) || typeof agent.role !== "string" || typeof agent.name !== "string") {
      return null;
    }
    const runKind = RUN_KINDS.find((k) => k === agent.run_kind);
    if (!runKind) return null;
    agents.push({
      role: agent.role,
      name: agent.name,
      run_kind: runKind,
      custom_flags: optionalString(agent.custom_flags),
      initial_prompt: optionalString(agent.initial_prompt),
    });
  }
  return { title: entry.title.trim(), layout, agents };
};

/**
 * Saves every importable entry under the legacy key into swarms.json, then deletes the key.
 * The key stays when any save fails, so the next load retries; saves upsert by name, so a
 * retry can't duplicate a swarm. Entries that can never be saved (blank or built-in name,
 * unknown layout or CLI, empty roster, unreadable JSON) are dropped with the key.
 */
const importLegacySwarms = async () => {
  const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
  if (raw === null) return;
  let entries: unknown = [];
  try {
    entries = JSON.parse(raw);
  } catch (err) {
    console.error("Saved swarms in localStorage are unreadable; nothing to import:", err);
  }
  const drafts = (Array.isArray(entries) ? entries : [])
    .map(legacyEntryToDraft)
    .filter((d): d is SwarmDraft => d !== null);
  for (const draft of drafts) {
    await invoke<SavedSwarm[]>("save_swarm", { swarm: draft });
  }
  localStorage.removeItem(LEGACY_STORAGE_KEY);
};

// One import per app run, even when React mounts the hook twice.
let legacyImport: Promise<void> | null = null;
const importLegacySwarmsOnce = () => {
  legacyImport ??= importLegacySwarms().catch((err) => {
    legacyImport = null;
    console.error("Failed to import saved swarms from localStorage:", err);
  });
  return legacyImport;
};

/**
 * The saved swarms in swarms.json, shared by the swarm builder and the command palette.
 * Call it once and pass the result down, so a save shows everywhere without a reload.
 */
export function useSavedSwarms() {
  const [saved, setSaved] = useState<SavedSwarm[]>([]);
  // Only the newest request's answer is applied, so a slow first load can't undo a save.
  const latestRequest = useRef(0);

  const apply = useCallback(async (request: Promise<SavedSwarm[]>) => {
    const id = ++latestRequest.current;
    const list = await request;
    if (id === latestRequest.current) setSaved(list);
    return list;
  }, []);

  useEffect(() => {
    importLegacySwarmsOnce()
      .then(() => apply(invoke<SavedSwarm[]>("list_saved_swarms")))
      .catch((err) => console.error("Failed to load saved swarms:", err));
    return () => {
      // A load still in flight at unmount is ignored.
      latestRequest.current++;
    };
  }, [apply]);

  /** Saves the form under its name, replacing a saved swarm with the same name. */
  const saveSwarm = useCallback(
    async (draft: SwarmDraft): Promise<SwarmPreset> => {
      const list = await apply(invoke<SavedSwarm[]>("save_swarm", { swarm: draft }));
      const stored = list.find((s) => sameSwarmName(s.title, draft.title));
      if (!stored) throw new Error(`Saved swarm "${draft.title}" is missing after the save.`);
      return savedSwarmToPreset(stored);
    },
    [apply]
  );

  const removeSwarm = useCallback(
    async (id: string) => {
      await apply(invoke<SavedSwarm[]>("remove_saved_swarm", { id }));
    },
    [apply]
  );

  const savedSwarms = useMemo(() => saved.map(savedSwarmToPreset), [saved]);

  return { savedSwarms, saveSwarm, removeSwarm };
}
