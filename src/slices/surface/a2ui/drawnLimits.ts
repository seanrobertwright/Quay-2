// How much of a surface may be drawn, and what counts for as much of it as a component does, as #765 measured.

/** The most components drawn at once. Mirrors `MOST_AT_ONCE`, which Rust holds every surface to. */
export const MOST_AT_ONCE = 2000;

/** The most components with every row drawn. Mirrors `MOST_WITH_ROWS`, which Rust holds every surface to. */
export const MOST_WITH_ROWS = 10_000;

/** Characters of text to draw. */
export const TEXT = 250;

/** Tokens of Markdown, as its parser has them. */
export const TOKENS = 8;

/** How many tokens more a link in Markdown counts for. */
export const LINK = 16;

/** Values of the data that a component is bound to, and calls of a function that it makes. */
export const STEPS = 4;

/** Characters of JSON that a component is written in. */
export const WRITTEN = 1000;

/** Characters of an id or a path that the engine names every component under it by. */
export const NAME = 100;

/** Characters of the data that a container tells a page of its rows apart by. */
export const ROW_DATA = 10_000;
