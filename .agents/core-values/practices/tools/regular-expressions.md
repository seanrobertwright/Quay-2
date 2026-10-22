# Regular expressions

> **Load when:** writing, reviewing, or debugging a regular expression in any
> language or tool (validation of input, search, find-and-replace, tokenizing,
> log or text extraction, routing or lint rules, pre-commit greps), building a
> pattern from user or config input, or investigating a slow or hanging match
> (ReDoS).
> **See also:** [Python](../languages/python.md),
> [Code design](../core/code-design.md), [Debugging](../core/debugging.md),
> [Algorithms and data structures](../algorithms/algorithms-and-data-structures.md),
> [Operating systems and Linux](../systems/operating-systems-and-linux.md),
> [Continuous integration and delivery](../devops/ci-cd.md)

## Top rules

1. **Anchor every validation regex to the whole input with a full-match API or
   absolute anchors.** An unanchored pattern accepts hostile input that merely
   contains a valid-looking piece. Use `re.fullmatch`, Java `matches()`, or
   `\A...\z`; group alternations first: `^(?:a|b)$`, never `^a|b$`.
   *[RegexCookbook ch. 3, 3.6; ch. 4, 4.1]*
2. **Reject trailing newlines and embedded lines in validators.** In Python,
   Java, .NET, Perl, PCRE, and Ruby, `$` (and `\Z` outside Python) also
   matches before a final line break, and
   multiline mode (always on for Ruby's `^`/`$`) lets one valid line smuggle
   the rest through. Use `\z` or a full-match API; in JavaScript leave `m` off.
   *[RegexCookbook ch. 2, 2.5; ch. 4, 4.1]*
3. **Treat catastrophic backtracking as a denial-of-service bug.** Flag any
   nested or adjacent quantifiers that can match the same characters
   (`(x+)+`, `(a|a?)*`, `(?:[^"]+|"")*`) and rewrite so each character can be
   consumed only one way. For untrusted input, also use a linear-time engine or
   a match timeout. *[RegexCookbook ch. 2, 2.15; ch. 7, 7.8; ch. 8, 8.4]*
4. **Escape literal text before splicing it into a pattern.** Ids, search terms,
   filenames, and config values go through `re.escape`, `Pattern.quote`,
   `Regex.Escape`, `preg_quote` (with the delimiter), `Regexp.escape`, or
   `RegExp.escape`; otherwise the text changes the pattern.
   *[RegexCookbook ch. 5, 5.14; Review lessons]*
5. **Passing a regex does not make a value safe for another interpreter.**
   Characters valid in an email address (`'`, `|`) are dangerous in SQL, shell,
   or HTML; parameterise or escape at the sink.
   *[RegexCookbook ch. 4, 4.1; Review lessons]*
6. **Do arithmetic and semantic checks in code, not in the pattern.** Extract
   digits with a simple regex, then check ranges, calendar validity, and
   checksums (Luhn, ISBN) in code or through the project's date helper.
   *[RegexCookbook ch. 3, 3.12; ch. 4, 4.5, 4.20; ch. 6, 6.7, 6.10; Review lessons]*
7. **Use a real parser for HTML, XML, URLs, CSV, JSON, and other nested
   formats.** Regexes classify flat tokens; they cannot track nesting or
   context. Never sanitise untrusted HTML by deleting tags with a regex.
   *[RegexCookbook ch. 3, 3.22; ch. 9, 9.1, 9.3]*
8. **Use the dot only where any character is allowed.** Everywhere else write a
   specific or negated class; a date pattern built from dots matches
   `12345678`. *[RegexCookbook ch. 2, 2.4]*
9. **Test with almost-matching inputs, not just valid ones.** Keep a saved set
   of valid and invalid samples, including long strings that fail at the very
   end, and time them; that is where runaway backtracking and loose anchoring
   show up. *[RegexCookbook ch. 2, 2.15; ch. 4, 4.1; ch. 7, 7.8]*
10. **Check the target flavor and version before using anything past the
    basics.** Lookbehind, atomic groups, `\A`/`\z`, Unicode classes, and mode
    letters differ between engines. *[RegexCookbook Preface; ch. 1; ch. 2, 2.4]*

## Validation: deciding what to accept

- **Write down what counts as valid before writing the pattern.** "Valid email"
  can mean syntactically legal, deliverable, or merely separable from
  surrounding text, and each needs a different regex. *[RegexCookbook ch. 4, 4.1]*
- **Match strictness to the trust level of the input.** A loose pattern is fine
  for extracting values from clean data; arbitrary user input needs a tight
  pattern, and rejecting every bad case is most of the work.
  *[RegexCookbook ch. 4, 4.1]*
- **When the truth lives outside the text, prefer a permissive pattern that
  never rejects a real value.** Only sending mail proves an address works;
  blocking a real user costs more than admitting a typo.
  *[RegexCookbook ch. 4, 4.1]*
- **Normalise before validating.** Strip spaces and hyphens from card or phone
  numbers and trim, then validate a simple canonical form instead of a regex
  that tolerates every format.
  *[RegexCookbook ch. 4, introduction, 4.20]*
- **Split multi-rule validation into one small check per rule.** Separate
  checks are readable and give a specific error per rule; if one regex is
  required, anchor its length lookahead at both ends so too-long input fails.
  *[RegexCookbook ch. 4, 4.19]*
- **Validate at the boundary with a parser that fails fast.** Env vars, CLI
  flags, query params, and request bodies go through one parsing step that
  rejects empty strings, malformed ids (for example a non-UUID), and
  out-of-range values with a clear message; a bare regex test followed by
  `Number()` on the raw value is not enough. *[Review lessons]*
- **Validate shell identifiers before they reach `export` or `eval`.** Use an
  anchored identifier pattern such as `\A[A-Za-z_][A-Za-z0-9_]*\z` (or the
  full-match equivalent) and reject everything else. *[Review lessons]*
- **Repeat every client-side regex check on the server.** Browser checks help
  users and are trivially bypassed. *[RegexCookbook ch. 4, 4.19]*
- **Do not hard-code lists that drift: TLDs, card prefixes, vendor names.**
  Own the update job or avoid the list; the book's own two-to-six-letter TLD
  limit is now wrong because generic TLDs run up to 63 characters.
  *[RegexCookbook ch. 4, 4.1, 4.20]*
- **Allow-list URL schemes by parsing the URL, not by pattern-matching the
  string.** Parse with the platform URL API and permit only `http`, `https`,
  `mailto`, and relative links; regex scheme checks miss case, whitespace,
  and encoding tricks. *[Review lessons; RegexCookbook ch. 9, 9.1]*
- **Do not parse dates or times with ad hoc regexes outside the project's one
  date helper.** A pattern may extract the digits, but the helper decides the
  calendar and timezone; a regex alone has to treat every year as a leap year.
  *[Review lessons; RegexCookbook ch. 4, 4.5]*

## Character classes, dot, and Unicode

- **A class matches exactly one character; never put words in one.** `[cat]{3}`
  matches `ttt`, and `[^cat]` is not "anything but cat". Use alternation or
  negative lookahead for words. *[RegexCookbook ch. 5, 5.3]*
- **Prefer a class to an alternation of single characters.** `[bcr]at` is
  clearer and faster than `(?:b|c|r)at`. *[RegexCookbook ch. 5, 5.3]*
- **Build ranges only between two digits or two same-case letters.** `[A-z]`
  silently includes the punctuation between `Z` and `a`.
  *[RegexCookbook ch. 2, 2.3]*
- **Escape `]`, `\`, `^`, and `-` inside classes.** Their meaning depends on
  position and flavor; escaping makes intent explicit everywhere.
  *[RegexCookbook ch. 2, 2.3]*
- **Remember that negated classes match line breaks.** `[^"]*` runs across
  lines unless you add `\r\n` to the exclusion. *[RegexCookbook ch. 2, 2.3]*
- **Check what `\w`, `\d`, and `\b` mean in the target engine before using them
  on non-ASCII text.** Flavors disagree on ASCII versus Unicode; use `\p{L}`,
  `\p{Lu}`, `\p{Nd}` when you mean any script. Python (str patterns) and .NET
  `\d` match every Unicode decimal digit by default, so write `[0-9]` or set
  the ASCII option when only ASCII digits are valid.
  *[RegexCookbook ch. 2, 2.6; ch. 4, 4.19]* (Updated: checked against current
  Python `re` docs.)
- **Use code-point escapes, not `\x80`-`\xFF`, for non-ASCII characters.** Byte
  escapes depend on engine and code page. *[RegexCookbook ch. 2, 2.2]*
- **Count and slice graphemes, not code points, for user-visible text.** A
  letter plus combining mark is two code points; use `\X` where the engine has
  it (Perl, PCRE, Java, Ruby) or a grapheme-aware API such as JavaScript
  `Intl.Segmenter`. *[RegexCookbook ch. 2, 2.7]* (Updated: `Intl.Segmenter`
  postdates the book.)
- **Name modes by effect: "dot matches line breaks" and "anchors match at line
  breaks".** The labels "single-line" and "multiline" are independent and
  routinely confused; Ruby's `m` means dot-all. *[RegexCookbook ch. 2, 2.4, 2.5]*

## Quantifiers, alternation, and backtracking

- **Make alternatives mutually exclusive instead of relying on branch order.**
  Backtracking engines take the first branch that matches, not the longest:
  `Jane|Janet` never matches all of "Janet"; `\bJanet?\b` does.
  *[RegexCookbook ch. 2, 2.8]*
- **Prefer patterns where greedy and lazy give the same answer.** A lazy `.*?`
  stops at the first delimiter, but making the repeated part exclude the
  delimiter (`"[^"]*"`) leaves only one possible match and runs faster.
  *[RegexCookbook ch. 2, 2.13]*
- **Use the "normal* (special normal*)*" shape for delimited content.** For a
  quoted string with escapes, match a run of ordinary characters, then any
  number of (escape, run); no character can be matched two ways.
  *[RegexCookbook ch. 3, 3.22; ch. 7, 7.8]*
- **Wrap steps that can never yield a new match in atomic groups or possessive
  quantifiers.** This removes needless backtracking, but it can also change
  which matches are found, so rerun the tests.
  *[RegexCookbook ch. 2, 2.14, 2.15]*
- **Use a linear-time engine for patterns or inputs from untrusted sources.**
  RE2, Go `regexp`, Rust `regex`, and .NET `RegexOptions.NonBacktracking`
  cannot backtrack catastrophically; they reject backreferences and lookaround
  (.NET's mode also rejects atomic groups and conditionals), which is usually
  an acceptable trade. *[RegexCookbook ch. 2, 2.15]*
  (Updated: the book predates these engines.)
- **Otherwise set a match timeout on server-side regexes.** .NET `Regex`
  accepts a timeout, Ruby 3.2 added `Regexp.timeout` and match caching; treat
  a timeout as a rejected input, not a crash. *[RegexCookbook ch. 2, 2.15]*
  (Updated: the book's only defence was careful design.)
- **Run a static ReDoS check in CI.** CodeQL ReDoS queries,
  `eslint-plugin-regexp`, `recheck`, or `safe-regex` catch ambiguous
  quantifiers before review does; keep the rule at error severity.
  *[RegexCookbook ch. 1; Review lessons]* (Updated: the book's SDL Regex Fuzzer
  is discontinued.)
- **After deleting an alternative, look for `||`, `(|`, or `|)`.** An empty
  branch makes the pattern accept the empty string.
  *[RegexCookbook ch. 4, 4.20]*
- **Do not use negative lookaround as a conditional's test.** It swaps the then
  and else branches and obscures the logic. *[RegexCookbook ch. 2, 2.17]*

## Search versus validation

- **When searching inside text, replace anchors with boundaries rather than
  deleting them.** Without anchors or `\b`/lookaround, an email pattern
  matches `ann@example.com` inside `ann@example.com77`.
  *[RegexCookbook ch. 4, 4.1; ch. 6, 6.7]*
- **Process line-oriented data line by line.** Split first, then apply simple
  per-line regexes; "lines without X" becomes a plain negated test in code.
  *[RegexCookbook ch. 3, 3.21]*
- **Find a token inside a region with two passes.** Match the outer region,
  then run an inner regex on each capture; one combined lookahead pattern is
  slower and harder to read. *[RegexCookbook ch. 3, 3.13]*

## Escaping, replacement, and injection

- **Escape `$` and `\` in replacement strings, or pass a replacement
  function.** Each flavor has its own replacement syntax.
  *[RegexCookbook ch. 2, 2.19]*
- **Write `${10}` or a named reference instead of `$10`.** `$10` is ambiguous
  in some flavors, and a reference to a missing group throws, becomes empty,
  or stays literal depending on the language. *[RegexCookbook ch. 2, 2.21]*
- **Use a callback when the replacement depends on the match.** Do not encode
  logic in replacement syntax or interpolate capture variables into the
  replacement string before the call runs. *[RegexCookbook ch. 3, 3.15, 3.16]*
- **Do not rely on `\Q...\E` for untrusted text.** A literal `\E` in the input
  ends the quoting; use the escape function. *[RegexCookbook ch. 5, 5.14]*
- **Catch compile errors for patterns from users or config, and report the
  engine's message.** Regex syntax errors surface at run time; make sure a test
  executes every hard-coded pattern's compile line.
  *[RegexCookbook ch. 3, 3.3; Review lessons]*
- **To sanitise markup, escape first and add structure after.** HTML-escape
  `&`, `<`, `>` before re-enabling an approved set of attribute-free tags, and
  use plain string replacement where no pattern is needed.
  *[RegexCookbook ch. 9, 9.1, 9.3, 9.5]*

## Using regexes in code

- **Compile once and reuse on hot paths; never build a pattern inside a
  per-row loop or a render function.** Convenience calls such as Java
  `String.matches` and `String.split` recompile each time, and engine caches
  are small; hoist the pattern to a module-level or `static final` constant
  and memoise results derived from it. *[RegexCookbook ch. 3, 3.3, 3.6;
  Review lessons]*
- **Share compiled patterns, not matchers.** Java `Pattern` is immutable and
  thread-safe while `Matcher` is not; JavaScript regexes with `g` or `y` carry
  `lastIndex` state, so do not share one across calls.
  *[RegexCookbook ch. 3, 3.3]* (Updated: the book wrongly calls `Pattern`
  unsafe.)
- **On .NET 7 and later, declare patterns known at compile time with
  `[GeneratedRegex]` instead of `RegexOptions.Compiled`.** The source
  generator gives compiled-speed matching without the start-up cost; keep
  `Compiled` for patterns built at run time on a measured hot path.
  *[RegexCookbook ch. 3, 3.3]* (Updated: the book predates the generator and
  warns only about `Compiled` start-up cost.)
- **Write patterns as raw strings or native regex literals.** Ordinary string
  literals double the backslashes and, in free-spacing mode, `"\n"` and
  `"\\n"` mean different things. *[RegexCookbook ch. 3, 3.1]*
- **Iterate matches with an iterator API (`matchAll`, `finditer`,
  `Matcher.find`).** A manual `exec` loop with `/g` spins forever on an empty
  match unless you advance the index yourself. *[RegexCookbook ch. 3, 3.11]*
- **Test group participation with `null`/`undefined`, not truthiness.** A
  group can match the empty string, which is falsy.
  *[RegexCookbook ch. 3, 3.22]*
- **Use `(?:...)` when you only need grouping, and named groups when code reads
  several captures.** Both keep group references stable when the pattern
  changes. *[RegexCookbook ch. 2, 2.9, 2.11; ch. 4, 4.5]*
- **Look up a captured name in a plain-object map with `Object.hasOwn`, or
  use a `Map`.** A captured `__proto__` or `constructor` otherwise resolves to
  an inherited property instead of failing the lookup. *[Review lessons]*

## Tokenizing and parsing

- **Use regexes to tokenize and code to parse.** Recursion and balancing groups
  can match nesting, and they show why that work belongs in code.
  *[RegexCookbook ch. 3, 3.13, 3.22]*
- **Give each token type its own named group and end with a catch-all error
  group such as `(?<bad>\S+)`.** Without it, a global match loop silently skips
  invalid text instead of reporting it. *[RegexCookbook ch. 3, 3.22]*
- **Keep regex edits on structured files to one-off, controlled inputs.**
  Scraping a known small set of files or repairing malformed near-XML is fine;
  production parsing of HTML, XML, CSV, or URLs uses a library.
  *[RegexCookbook ch. 9, opening, 9.1]*

## Readability, review, and maintenance

- **Comment every non-trivial pattern, using free-spacing (verbose) mode where
  the flavor has it.** In that mode, escape literal spaces and `#`, and note
  that Java also ignores whitespace inside classes. JavaScript has no
  free-spacing mode, so build it from commented parts or document it above.
  *[RegexCookbook ch. 2, 2.18]*
- **Keep the comment, docstring, and error message in step with what the
  pattern accepts.** "Matches ISO dates" on a pattern that also accepts
  `2024-13-45`, or "rejects empty" on a pattern with `*`, is a defect; audit
  every claim the change touches. *[Review lessons]*
- **After fixing a regex bug, grep the repo for the same pattern and fix every
  copy in the same change.** Validation patterns are copy-pasted across
  handlers, so one fix usually has siblings. *[Review lessons]*
- **Write pre-commit and CI content greps as anchored, escaped, tested
  patterns.** A gate that blocks personal identifiers and the U+FFFD
  replacement character must escape every literal it searches for, and its
  test must prove both a hit and a miss. *[Review lessons; RegexCookbook ch. 5, 5.14]*
- **Prefer readable over clever.** If a pattern needs nested lookarounds to fit
  in one expression, split it into several regexes plus code.
  *[RegexCookbook ch. 3, 3.13; ch. 4, 4.19]*

## Flavor notes (current engines)

- **JavaScript:** ES2018 added lookbehind, the `s` flag, named groups, and
  `\p{...}` under `u`; ES2020 added `matchAll`; ES2024 added the `v` flag;
  ES2025 added `RegExp.escape` (Baseline 2025, so polyfill for older
  runtimes), inline modifiers such as `(?i:...)`, and duplicate named groups
  across alternatives. There is still no `\A`/`\z`,
  free-spacing, atomic group, or possessive quantifier; without `m`, `$`
  matches only at the very end. *[RegexCookbook ch. 2, 2.4, 2.5]* (Updated:
  the book's `[\s\S]` workarounds and XRegExp advice are mostly unnecessary.)
- **Python:** use `re.fullmatch` for validation; `\Z` means absolute end, and
  Python 3.14 also accepts `\z` with the same meaning. Python 3.11 added
  atomic groups and possessive quantifiers.
  *[RegexCookbook ch. 2, 2.5, 2.14]* (Updated: the book says Python cannot
  avoid needless backtracking.)
- **Ruby:** `^` and `$` always match at line breaks; validate with `\A...\z`.
  *[RegexCookbook ch. 2, 2.5; ch. 4, 4.1]*
- **PHP:** replace `create_function` callbacks with closures; it was removed in
  PHP 8. *[RegexCookbook ch. 3, 3.16]*

## Tensions

- **`\Z` versus `\z` for whole-string validation.** The book recommends `\Z` or
  `$` because ignoring a trailing newline is convenient for line input. This
  library requires `\z`, Python `\Z`, or a full-match API for validators so
  `value\n` is rejected; `$` is fine for searching line-oriented text.
  *[RegexCookbook ch. 2, 2.5; Review lessons]*
- **Regex for HTML and XML versus "always use a parser".** The authors reject
  the absolutist ban and give heavy tag patterns. This library uses a parser
  whenever accuracy or security matters, and allows regexes only for one-off
  edits on controlled inputs. Sanitising untrusted HTML by regex is never
  allowed. *[RegexCookbook ch. 9, 9.1]*
- **Careful pattern design versus engine-level ReDoS defences.** The book
  relies on design and atomic groups. This library requires both: design
  patterns to be unambiguous, and for untrusted input also use a linear-time
  engine or a timeout, because one missed pattern is an outage.
  *[RegexCookbook ch. 2, 2.15]*
- **Composition-rule password regexes versus current guidance.** The book's
  password recipe enforces character-class mixes and a 32-character maximum.
  NIST SP 800-63B-4 forbids composition rules, requires at least 15
  characters for a password used alone (8 inside multi-factor), asks for a
  maximum of at least 64, accepts printable ASCII, space, and Unicode, and
  requires a blocklist check of common and breached passwords. This library
  follows NIST and uses per-rule regexes only when a policy truly mandates
  them. *[RegexCookbook ch. 4, 4.19; NIST SP 800-63B]*
- **Strict versus permissive validation.** Strict patterns stop bad data;
  permissive ones avoid rejecting real users. Be strict for identifiers the
  system owns (ids, shell names, enum values) and permissive for facts only
  the outside world can confirm (emails, names, addresses), confirming those
  another way. *[RegexCookbook ch. 4, 4.1; Review lessons]*
- **Hard-coded card-brand prefixes versus processor checks.** The book's prefix
  table predates the Mastercard 2-series; use Luhn plus the payment
  processor's response instead of brand regexes. *[RegexCookbook ch. 4, 4.20]*

## Sources

- **RegexCookbook**: Regular Expressions Cookbook, 2nd Edition (Jan Goyvaerts,
  Steven Levithan; O'Reilly, 2012)
- **NIST SP 800-63B**: NIST Special Publication 800-63B-4, Digital Identity
  Guidelines: Authentication and Authenticator Management
  (<https://pages.nist.gov/800-63-4/sp800-63b.html>)
- **Review lessons**: rules distilled from the maintainer's code-review findings
