// The shell's own preferences: the Project panel's Quay · every project group. They are kept in
// the WebView's `localStorage`, so per machine and for every project, and each is validated as it
// is read: a missing or unknown stored value reads as the setting's default.
import { OPENS_ON_KEY, type CompanionOpensOn, type PrefsStorage } from "../companion/companionPrefs.ts";

/** A pie palette: its name and the two colours its swatch shows. Spectrum gives one hue per action. */
export interface PiePalette {
  id: string;
  label: string;
  colors: readonly [string, string];
}

/** The six pie palettes, in the order the Project panel lists them. */
export const PIE_PALETTES = [
  { id: "spectrum", label: "Spectrum", colors: ["#7df9ff", "#ffffff"] },
  { id: "cyber", label: "Cyan + magenta", colors: ["#00f0ff", "#ff2bd6"] },
  { id: "tron", label: "Cyan + orange", colors: ["#18e0ff", "#ff9a1f"] },
  { id: "acid", label: "Lime + cyan", colors: ["#b6ff1a", "#00e5ff"] },
  { id: "sunset", label: "Pink + yellow", colors: ["#ff3d81", "#ffd60a"] },
  { id: "ice", label: "Ice white + green", colors: ["#dfe9ff", "#39ff88"] },
] as const satisfies readonly PiePalette[];

export type PiePaletteId = (typeof PIE_PALETTES)[number]["id"];

/** Every shell preference's current value. */
export interface ShellPrefs {
  piePalette: PiePaletteId;
  pieLabelOutline: boolean;
  /** How long a held button waits before the pie draws, in ms; 0 is None. */
  pieDisplayDelayMs: 0 | 150 | 300;
  /** How long a Merge waits, with Cancel, before it runs, in s; 0 is Off. */
  mergeUndoSeconds: 0 | 3 | 5 | 10;
  companionOpensOn: CompanionOpensOn;
  soundChime: boolean;
}

export type ShellPrefKey = keyof ShellPrefs;

/** Stores `value` for the setting `key`; the one signature every caller that sets a preference takes. */
export type SetShellPref = <K extends ShellPrefKey>(key: K, value: ShellPrefs[K]) => void;

/** One value a setting can take, as the panel and the palette name it. */
export interface PrefOption<V> {
  value: V;
  label: string;
}

/** One shell setting: its name, where it is stored, the values it takes and its default. */
export interface ShellSetting<K extends ShellPrefKey = ShellPrefKey> {
  key: K;
  label: string;
  storageKey: string;
  /** "choice" shows as a set of radio buttons; "toggle" as one on/off switch. */
  kind: "choice" | "toggle";
  options: readonly PrefOption<ShellPrefs[K]>[];
  defaultValue: ShellPrefs[K];
  /**
   * The CSS background of the swatch each value's radio shows. A choice with swatches lays its
   * radios out as a grid of swatch buttons.
   */
  swatch?: (value: ShellPrefs[K]) => string;
}

type SettingTable = { [K in ShellPrefKey]: ShellSetting<K> };

const SPECTRUM_SWATCH = "linear-gradient(90deg,hsl(170,100%,62%),hsl(260,100%,62%),hsl(350,100%,62%),hsl(80,100%,62%))";

/** A pie palette's swatch: Spectrum's hues, else its two colours side by side. */
function paletteSwatch(id: PiePaletteId): string {
  if (id === "spectrum") return SPECTRUM_SWATCH;
  const [a, b] = PIE_PALETTES.find((p) => p.id === id)?.colors ?? PIE_PALETTES[0].colors;
  return `linear-gradient(90deg,${a} 50%,${b} 50%)`;
}

const ON_OFF = [
  { value: true, label: "On" },
  { value: false, label: "Off" },
] as const;

// The table's key order is the order the Project panel and the palette show the settings.
const SETTINGS: SettingTable = {
  piePalette: {
    key: "piePalette",
    label: "Pie palette",
    storageKey: "quay_pie_palette",
    kind: "choice",
    options: PIE_PALETTES.map((p) => ({ value: p.id, label: p.label })),
    defaultValue: "spectrum",
    swatch: paletteSwatch,
  },
  pieLabelOutline: {
    key: "pieLabelOutline",
    label: "Pie label outline",
    storageKey: "quay_pie_label_outline",
    kind: "toggle",
    options: ON_OFF,
    defaultValue: true,
  },
  pieDisplayDelayMs: {
    key: "pieDisplayDelayMs",
    label: "Pie display delay",
    storageKey: "quay_pie_display_delay_ms",
    kind: "choice",
    options: [
      { value: 0, label: "None" },
      { value: 150, label: "150 ms" },
      { value: 300, label: "300 ms" },
    ],
    defaultValue: 150,
  },
  mergeUndoSeconds: {
    key: "mergeUndoSeconds",
    label: "Merge undo window",
    storageKey: "quay_merge_undo_seconds",
    kind: "choice",
    options: [
      { value: 0, label: "Off" },
      { value: 3, label: "3 s" },
      { value: 5, label: "5 s" },
      { value: 10, label: "10 s" },
    ],
    defaultValue: 5,
  },
  companionOpensOn: {
    key: "companionOpensOn",
    label: "Companion opens on",
    // Shared with the companion, which reads the setting when it picks its first view.
    storageKey: OPENS_ON_KEY,
    kind: "choice",
    options: [
      { value: "pull-request", label: "Pull request" },
      { value: "ticket", label: "Ticket" },
      { value: "activity", label: "Activity" },
    ],
    defaultValue: "pull-request",
  },
  soundChime: {
    key: "soundChime",
    label: "Sound chime",
    // Shared with the chime player, which reads it before each chime.
    storageKey: "quay_chime_enabled",
    kind: "toggle",
    options: ON_OFF,
    defaultValue: true,
  },
};

/** The shell settings, in the order the Project panel shows them. */
export const SHELL_SETTINGS: readonly ShellSetting[] = Object.values(SETTINGS) as ShellSetting[];

/** The setting `key` names. */
export function shellSetting<K extends ShellPrefKey>(key: K): ShellSetting<K> {
  return SETTINGS[key] as ShellSetting<K>;
}

/** A setting's value as it is stored: its value as a string. */
const stored = (value: ShellPrefs[ShellPrefKey]): string => String(value);

function readSetting<K extends ShellPrefKey>(storage: PrefsStorage, setting: ShellSetting<K>): ShellPrefs[K] {
  const raw = storage.getItem(setting.storageKey);
  const match = setting.options.find((option) => stored(option.value) === raw);
  return match ? match.value : setting.defaultValue;
}

/** Every shell preference in `storage`; a missing or unknown value reads as its default. */
export function readShellPrefs(storage: PrefsStorage): ShellPrefs {
  // SETTINGS is keyed by every ShellPrefKey, so the entries cover the whole of ShellPrefs.
  return Object.fromEntries(SHELL_SETTINGS.map((setting) => [setting.key, readSetting(storage, setting)])) as unknown as ShellPrefs;
}

/** Stores `value` for the setting `key`. A value the setting does not take is not stored. */
export function writeShellPref<K extends ShellPrefKey>(storage: PrefsStorage, key: K, value: ShellPrefs[K]): void {
  const setting = shellSetting(key);
  if (!setting.options.some((option) => option.value === value)) return;
  storage.setItem(setting.storageKey, stored(value));
}

/** A `Preferences: …` palette command: running it stores `value` for the setting `key`. */
export interface PreferenceCommand {
  id: string;
  title: string;
  key: ShellPrefKey;
  value: ShellPrefs[ShellPrefKey];
  /** Whether the setting already has this value. */
  current: boolean;
}

/**
 * The `Preferences: …` palette commands for `prefs`: one per value of a choice, so each change is
 * one pick, and one per toggle that flips it.
 */
export function preferenceCommands(prefs: ShellPrefs): PreferenceCommand[] {
  return SHELL_SETTINGS.flatMap((setting): PreferenceCommand[] => {
    const now = prefs[setting.key];
    if (setting.kind === "toggle") {
      return [
        {
          id: `preferences-${setting.key}`,
          title: `Preferences: ${setting.label}: ${now ? "Turn off" : "Turn on"}`,
          key: setting.key,
          value: !now,
          current: false,
        },
      ];
    }
    return setting.options.map((option) => ({
      id: `preferences-${setting.key}-${String(option.value)}`,
      title: `Preferences: ${setting.label}: ${option.label}`,
      key: setting.key,
      value: option.value,
      current: option.value === now,
    }));
  });
}
