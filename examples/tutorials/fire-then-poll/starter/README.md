# fire-then-poll

A tiny word-count library with two implementations of the same function. `countWordsNaive`
keeps an array of `[word, count]` pairs and searches it for every word. `countWordsMap` keeps a
`Map`. Both return the same pairs, most frequent first. `npm run bench` times the two on a
20,000-word sample text for about 90 seconds and prints a table comparing them.
