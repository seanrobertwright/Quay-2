const SYLLABLES = ["ka", "lo", "mi", "ra", "te", "su", "no", "vi", "be", "da", "po", "xe"];

/** A small seeded generator (mulberry32), so every run builds the same text. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The benchmark's sample text: `wordCount` words drawn from a vocabulary of
 * `vocabularySize` made-up words, with punctuation and capitals mixed in.
 * The same arguments always give the same text.
 */
export function buildCorpus(wordCount = 20_000, vocabularySize = 3_000, seed = 6): string {
  const next = random(seed);
  const vocabulary: string[] = [];
  const seen = new Set<string>();
  while (vocabulary.length < vocabularySize) {
    let word = "";
    const length = 2 + Math.floor(next() * 3);
    for (let i = 0; i < length; i++) word += SYLLABLES[Math.floor(next() * SYLLABLES.length)];
    if (!seen.has(word)) {
      seen.add(word);
      vocabulary.push(word);
    }
  }
  const out: string[] = [];
  for (let i = 0; i < wordCount; i++) {
    let word = vocabulary[Math.floor(next() * vocabulary.length)];
    if (next() < 0.1) word = word[0].toUpperCase() + word.slice(1);
    if (next() < 0.08) word += next() < 0.5 ? "," : ".";
    out.push(word);
  }
  return out.join(" ");
}
