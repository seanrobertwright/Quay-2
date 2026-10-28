# Text stats

`node src/cli.ts <file>` reads a UTF-8 text file and prints one line with its line count, its
word count and its most frequent word. `src/cli.ts` is finished. The three functions it calls
live in `src/stats.ts`, and they follow the rules below.

## Lines: `countLines(text)`

- Empty text has 0 lines.
- Every line break, `\n` or `\r\n`, ends a line.
- A final line with no line break after it still counts. A line break at the very end of the
  text does not start another line, so `"a\nb\n"` and `"a\nb"` both have 2 lines.

## Words: `countWords(text)`

- A word is a run of characters that are not whitespace. Spaces, tabs and line breaks separate
  words, and a run of several counts as one separator.
- Punctuation stays part of its word here: `"ropes, gulls"` is 2 words.

## Top word: `topWord(text)`

- Lowercase the text, then take every run of the letters `a` to `z` and the digits `0` to `9`.
  Everything else separates them, so `"Quay, quay! QUAY."` holds `quay` three times.
- Return the run that appears most often, as `{ word, count }`.
- When two runs appear equally often, return the one that appears first in the text.
- When the text has no such run, throw `new Error("no words")`.

## The CLI

With no file named, it prints `Usage: node src/cli.ts <file>` to stderr and exits 2. Otherwise
it prints one line, with two spaces between its parts:

```text
Lines: <lines>  Words: <words>  Top word: <word> (<count>)
```

For `sample.txt`, the last line of this file is exactly what it must print:

Lines: 5  Words: 69  Top word: the (12)
