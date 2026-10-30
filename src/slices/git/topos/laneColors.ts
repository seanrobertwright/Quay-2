// Track colors for the Topos graph (#348, #351, #375), written fresh from the `topos-lane-geometry`
// findings. A color belongs to a track, not to a lane: FNV-1a 32-bit over the track key picks one
// of 12 slots, slot 0 is kept for the default branch, and the colors themselves are the
// `--topos-lane-N` CSS variables each theme defines in `src/index.css`.

import type { TrackKind } from "./graphPage.ts";

export const SLOT_COUNT = 12;
/** Slots other than the default branch's slot 0. */
const HASHED_SLOTS = SLOT_COUNT - 1;
/** How far a clashing derived or anonymous track steps; coprime with 11, so it visits every slot. */
const PROBE_STEP = 5;

const utf8 = new TextEncoder();

/** FNV-1a 32-bit over the UTF-8 bytes of `key`. */
export function fnv1a32(key: string): number {
  let hash = 0x811c9dc5;
  for (const byte of utf8.encode(key)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Whether two slots are the same hue or neighbours on the 12-hue circle. */
function clashes(a: number, b: number): boolean {
  const apart = Math.abs(a - b) % SLOT_COUNT;
  return Math.min(apart, SLOT_COUNT - apart) <= 1;
}

/**
 * The color slot of a track. The default branch takes slot 0, and a named branch its pure-hash slot,
 * so it looks the same in every repo state. A derived or anonymous track whose slot is within one
 * hue of a neighbouring lane's slot steps by 5 (mod 11) until it isn't (#351).
 */
export function trackSlot(track: { kind: TrackKind; key: string }, neighbourSlots: readonly number[]): number {
  if (track.kind === "default") return 0;
  let slot = 1 + (fnv1a32(track.key) % HASHED_SLOTS);
  if (track.kind === "named") return slot;
  for (let tries = 0; tries < HASHED_SLOTS && neighbourSlots.some((n) => clashes(slot, n)); tries++) {
    slot = 1 + ((slot - 1 + PROBE_STEP) % HASHED_SLOTS);
  }
  return slot;
}

/** The CSS color of `slot`. */
export function slotColor(slot: number): string {
  return `var(--topos-lane-${slot})`;
}
