/** One word and how many times it appears. */
export type WordCount = [word: string, count: number];

/** Lowercase words: runs of letters and digits, so punctuation never counts. */
function words(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

/** Most frequent first; equal counts in alphabetical order. */
function byCountThenWord(a: WordCount, b: WordCount): number {
  return b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
}

/** Keeps an array of pairs and searches it for every word. */
export function countWordsNaive(text: string): WordCount[] {
  const counts: WordCount[] = [];
  for (const word of words(text)) {
    const pair = counts.find(([seen]) => seen === word);
    if (pair) pair[1] += 1;
    else counts.push([word, 1]);
  }
  return counts.sort(byCountThenWord);
}

/** Keeps a Map from word to count. */
export function countWordsMap(text: string): WordCount[] {
  const counts = new Map<string, number>();
  for (const word of words(text)) counts.set(word, (counts.get(word) ?? 0) + 1);
  return [...counts].sort(byCountThenWord);
}
