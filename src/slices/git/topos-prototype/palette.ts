// PROTOTYPE (#351). Track color slots, per the #348 findings: FNV-1a 32-bit of
// the track key into slots 1..11, slot 0 kept for the default branch. The CSS
// for each slot lives in topos-prototype.css as --topos-lane-<n>.

export const SLOT_COUNT = 12;

export function fnv1a32(text: string): number {
  const bytes = new TextEncoder().encode(text);
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

export function hashedSlot(key: string, defaultBranch: string): number {
  if (key === defaultBranch) return 0;
  return 1 + (fnv1a32(key) % (SLOT_COUNT - 1));
}

/** Slots sit on a 12-hue ring 30° apart, so slot 11 and slot 0 are neighbours. */
export function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % SLOT_COUNT;
  return Math.min(d, SLOT_COUNT - d);
}

/**
 * The open-question variant: if the slot is within one hue step of a
 * neighbouring lane's slot, step by 5 (mod 11) until it is not. Gives up after
 * 11 tries and keeps the hashed slot.
 */
export function probeSlot(slot: number, neighbours: number[]): number {
  if (slot === 0) return slot;
  let candidate = slot;
  for (let tries = 0; tries < SLOT_COUNT - 1; tries++) {
    if (neighbours.every((n) => hueDistance(candidate, n) > 1)) return candidate;
    candidate = 1 + ((candidate - 1 + 5) % (SLOT_COUNT - 1));
  }
  return slot;
}
