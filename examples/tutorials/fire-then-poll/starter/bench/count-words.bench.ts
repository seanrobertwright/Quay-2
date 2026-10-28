import { test } from "vitest";
import { countWordsMap, countWordsNaive } from "../src/count-words.ts";
import { buildCorpus } from "../src/corpus.ts";

const MAX_BENCH_TIME_MS = 600_000;

/** How long each task runs, in milliseconds. CI sets it low to run the bench quickly. */
function benchTimeMs(): number {
  const raw = process.env.BENCH_TIME_MS;
  if (raw === undefined) return 90_000;
  if (!/^[1-9][0-9]*$/.test(raw)) {
    throw new Error(`BENCH_TIME_MS must be a positive whole number of milliseconds, got "${raw}"`);
  }
  const ms = Number(raw);
  if (ms > MAX_BENCH_TIME_MS) {
    throw new Error(`BENCH_TIME_MS must be at most ${MAX_BENCH_TIME_MS} (ten minutes), got ${ms}`);
  }
  return ms;
}

const time = benchTimeMs();
const corpus = buildCorpus();

test("countWords on a 20,000-word corpus", { timeout: 4 * time + 60_000 }, async ({ bench }) => {
  await bench.compare(
    bench("naive", () => {
      countWordsNaive(corpus);
    }),
    bench("map", () => {
      countWordsMap(corpus);
    }),
    { time, iterations: 10, warmupIterations: 2 },
  );
});
