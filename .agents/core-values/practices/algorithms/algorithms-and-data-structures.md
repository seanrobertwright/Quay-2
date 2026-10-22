# Algorithms and data structures

> **Load when:** choosing, implementing, or reviewing a data structure or
> algorithm (collections, hashing, sorting, searching, selection, trees, heaps,
> graphs, dynamic programming, greedy or backtracking search, string matching),
> stating or checking a time or space complexity claim, or fixing code whose
> cost grows faster than its input.
> **See also:** [Concurrency and parallelism](../concurrency/concurrency.md),
> [SQL and query performance](../data/sql-and-query-performance.md),
> [Database operations](../data/database-operations.md),
> [Application and API security](../security/application-security.md),
> [Testing](../testing/testing.md),
> [Performance and load testing](../testing/performance-and-load-testing.md),
> [Web performance](../frontend/web-performance.md),
> [Regular expressions](../tools/regular-expressions.md)

## Top rules

1. **Settle the order of growth of the hot path before tuning constants or
   adding hardware.** An n log n algorithm on a far slower machine beats a tuned
   n² one once n reaches the millions, and the gap widens with n.
   *[CLRS ch. 1; Algorithms Unlocked ch. 1; DSAME-Java ch. 1]*
2. **For every loop, list, and query, state the cost at 10k rows and at 10
   million.** Cap or paginate unbounded lists, and do not recompute an expensive
   derivation on every call or render. *[Review lessons]*
3. **Use the standard library's sort, map, set, heap, and shuffle; hand-roll
   one only when profiling or a missing feature demands it.** Updated: the books
   hand-roll everything, but library versions are hybrid, worst-case bounded,
   and tested. *[CLRS ch. 7; Algorithms Unlocked ch. 3; DSAME-Java ch. 10]*
4. **Pick a data structure from the operations the code performs and how often
   each runs.** Hash tables give fast lookup and no order, balanced trees give
   ordered and range queries at log n, heaps give only the minimum or maximum.
   *[CLRS Part III intro; Algorithms Unlocked ch. 6; DSAME-Java ch. 14]*
5. **Count hidden costs: a library call inside a loop is not a constant-time
   step.** `includes`, `indexOf`, slicing, `sort`, and string concatenation
   inside a loop turn a linear pass into a quadratic one. *[CLRS ch. 2]*
6. **Never rely on an input distribution you cannot enforce.** Sorted, repeated,
   or attacker-chosen inputs break average-case bounds; randomize inside the
   algorithm (random pivots, seeded hashes) or pick a worst-case-bounded one.
   *[CLRS ch. 2, 5, 11; DSAME-Java ch. 1, 14]*
7. **State which case a complexity claim covers, in which size parameters.**
   Name n (or V and E, k, or bits for numeric input), say worst, average, or
   amortized, and use Θ only for a tight bound: an early-exit search is Θ(n)
   worst case and Θ(1) best case. Make docstrings and PR text match the code.
   *[Algorithms Unlocked ch. 1, 2; DSAME-Java ch. 1; CLRS ch. 31; Review lessons]*
8. **Keep a brute-force version as a test oracle for every clever algorithm.**
   Compare the fast version against it on small random inputs to catch unsafe
   greedy rules, off-by-one bounds, and broken edge cases.
   *[DSAME-Java Preface; CLRS ch. 16]*
9. **Before writing an exhaustive search, estimate the search space and check
   whether it is a disguised NP-hard one (TSP, knapsack, subset sum, vertex
   cover, Hamiltonian path, SAT).** Then choose a small-input exact search, a
   special case, or an approximation with a stated factor.
   *[CLRS ch. 34, 35; Algorithms Unlocked ch. 10; DSAME-Java ch. 20]*
10. **Bound recursion depth on any input you do not control.** Recurse on the
    smaller half and loop on the larger, or convert to an explicit stack.
    *[CLRS ch. 7; DSAME-Java ch. 2]*

## Complexity analysis and claims

- **Write the problem as an input and output specification, including every
  constraint on valid inputs, before writing the procedure.** Without it there
  is no definition of "correct for every input" and nothing to test against.
  *[CLRS ch. 1; Algorithms Unlocked ch. 1]*
- **When two candidates share an order of growth, benchmark several sizes and
  input orders on the target machine.** One run says nothing about the others.
  *[Algorithms Unlocked ch. 1, 3]*
- **Treat an amortized bound as a total over a sequence, not a per-call latency
  limit.** One resize still costs linear time; pre-size the structure or use one
  with a per-operation bound on latency-sensitive paths.
  *[CLRS ch. 17; DSAME-Java ch. 1]*
- **After fixing a quadratic pattern, sweep the codebase for its siblings.** The
  same lookup-in-a-loop or per-render recomputation usually exists in several
  handlers; fix them all in the same change. *[Review lessons]*

## Choosing data structures

- **Default to arrays and dynamic arrays for indexed access and iteration.**
  Contiguous memory suits caches; use a linked list only for frequent insertion
  or deletion at a position you already hold.
  *[DSAME-Java ch. 3; Algorithms Unlocked ch. 5]*
- **Grow dynamic arrays and tables geometrically, and shrink at a lower
  threshold than growth (for example, double when full, halve at one quarter).**
  A fixed growth step makes n appends quadratic, and halving at one half thrashes
  on alternating push and pop. *[CLRS ch. 17; DSAME-Java ch. 3, 4]*
- **Code the algorithm against an interface, then pick the implementation from
  operation counts.** Dijkstra with a binary heap wins on sparse graphs; a plain
  array can win on dense ones. *[Algorithms Unlocked ch. 6]*
- **Back a priority queue with a binary or 4-ary heap built bottom-up in
  O(n).** Lists make insert or extract O(n), and Fibonacci heaps lose on
  constants. *[DSAME-Java ch. 7; Algorithms Unlocked ch. 6; CLRS ch. 19]*
- **When a heap holds application objects, keep handles in both directions and
  update them on every move, or use lazy deletion.** A stale heap index is
  silent corruption; without decrease-key, push a duplicate and skip stale
  entries on pop. *[CLRS ch. 6, 19]*
- **Use a balanced tree or the library's ordered map, never a plain BST, for
  keys whose insertion order you do not control.** Sorted inserts turn a BST
  into a linked list. *[CLRS ch. 12, 13; DSAME-Java ch. 6]*
- **For string keys, use a hash set for exact match, a trie or ternary search
  tree for prefix search or sorted output, and a suffix array or tree for
  substring queries over one large text.** *[DSAME-Java ch. 15]*
- **Implement union-find with union by rank or size plus path compression.**
  Without both, unions can build linear-height trees.
  *[CLRS ch. 21; DSAME-Java ch. 8]*
- **Use a Bloom filter only as a "definitely absent" pre-check, sized for its
  target false-positive rate.** It has false positives, no false negatives, and
  no deletion; about 9.6 bits per element gives 1%, and each further 4.8 bits
  cuts the rate tenfold. *[DSAME-Java ch. 14]*
- **Specify what a container does when empty or full.** Throw a specific error
  or return an explicit empty result, so callers can tell "empty" from a stored
  zero or null. *[DSAME-Java ch. 5]*

## Hash tables

- **Make the hash depend on all bits of the key.** A hash that ignores bits, or
  a bucket index that keeps only the low bits of a weak hash, maps real key
  patterns into collisions. *[CLRS ch. 11; DSAME-Java ch. 14]*
- **Use a seeded or keyed hash for any key an attacker can choose.** A fixed
  hash lets an adversary put every key in one bucket; never swap a runtime's
  keyed hash for a fast unkeyed one on such inputs.
  *[CLRS ch. 11; DSAME-Java ch. 14]*
- **Track the load factor and rehash past a fixed threshold.** Average O(1)
  holds only because resizing keeps chains and probe sequences short.
  *[DSAME-Java ch. 14; CLRS ch. 11]*
- **Do not use a hash table for ordered iteration, range, prefix, or
  multi-dimensional queries.** Use an ordered map, trie, or spatial index.
  *[DSAME-Java ch. 14, 15]*
- **Under heavy deletion, use chaining or an open-addressing table that cleans
  up or rebuilds past its tombstones.** Deleted-slot markers make open-address
  search slower over time until a rebuild. *[CLRS ch. 11; DSAME-Java ch. 14]*
- **Use a real map type, or an own-property check, when a plain object serves
  as a dictionary.** An `in`-style check also sees inherited keys that were
  never inserted. *[Review lessons]*

## Sorting, searching, and selection

- **Use a stable sort, called by name where the default is not stable, when
  equal keys must keep their order or a multi-key sort runs least significant
  key first.** Python `sorted`, Java object `Arrays.sort`, JavaScript `sort`
  (ES2019+), and Rust `sort` are stable; C++ `std::sort`, Rust `sort_unstable`,
  and Go `slices.SortFunc` are not (use `std::stable_sort`,
  `slices.SortStableFunc`). *[CLRS ch. 8; Algorithms Unlocked ch. 4;
  DSAME-Java ch. 10; Python Sorting Techniques; Java SE 21 Arrays;
  MDN Array.prototype.sort; cppreference std::stable_sort; Go slices package]*
- **Define the comparator explicitly as a consistent total order with
  tie-breaks, and move the record with its key.** Java may throw and Rust 1.81+
  may panic on an inconsistent comparator, and JavaScript's default compares as
  strings (`[10, 9, 1].sort()` gives `[1, 10, 9]`). *[Algorithms Unlocked ch. 3;
  Java SE 21 Arrays; Rust 1.81.0 release; MDN Array.prototype.sort]*
- **Sort references or indices, not large records.** Moving keys moves payloads;
  permute the payload once at the end if needed. *[CLRS Part II intro]*
- **If you must write a quicksort, randomize the pivot or use median-of-three,
  partition three ways for equal keys, and cut over to insertion sort below a
  threshold measured on the target machine.** A fixed pivot goes quadratic on
  sorted input, a two-way partition on all-equal keys, and the best cutoff
  differs from one machine to the next.
  *[CLRS ch. 2, 7; Algorithms Unlocked ch. 3; DSAME-Java ch. 10]*
- **Use counting or radix sort only for small integer ranges or fixed-width
  keys, and benchmark against the library sort.** Linear passes can still lose
  on caches and memory.
  *[CLRS ch. 8; Algorithms Unlocked ch. 4; DSAME-Java ch. 10]*
- **Use insertion sort, not bubble sort, for small or nearly sorted input.**
  Insertion sort is stable, in place, and linear in the number of inversions,
  and it also detects presorted input, bubble sort's only advantage.
  *[DSAME-Java ch. 10; Algorithms Unlocked ch. 3]*
- **Sort data larger than memory with an external merge sort:** write sorted
  runs, then k-way merge with one buffer per run. *[DSAME-Java ch. 10]*
- **For a median, top-k, or percentile, use quickselect or a size-k heap, not a
  full sort.** Sort once and binary search only when many queries share the
  data. *[CLRS ch. 9; DSAME-Java ch. 12; Algorithms Unlocked ch. 3]*
- **Compute midpoints as `low + (high - low) / 2` (or `(low + high) >>> 1` in
  Java).** `(low + high) / 2` overflows fixed-width integers on large indices.
  *[DSAME-Java ch. 11, 21]*
- **Return from a search at the first match, and signal "not found" with a
  value that can never be a valid result.** If which match matters, the spec
  says which. *[Algorithms Unlocked ch. 2]*

## Loops, recursion, and correctness

- **State a loop invariant for any non-obvious loop and check initialization,
  maintenance, and termination.** Termination plus the exit condition is the
  proof and the step most often skipped; write it as an assertion or comment.
  *[CLRS ch. 2; Algorithms Unlocked ch. 2]*
- **Give every recursion a base case and make every call strictly smaller and
  convergent on it.** A valid identity that moves away from the base case never
  terminates. *[Algorithms Unlocked ch. 2; DSAME-Java ch. 2]*
- **Prefer iteration when depth grows with input; keep recursion for bounded
  depth such as balanced trees.** Do not count on tail-call elimination: Java,
  Python, and most JavaScript engines do not do it (a correction to the book's
  claim about compiled loops). *[DSAME-Java ch. 2]*
- **Never read or write past an array's end.** Use a sentinel only in a
  measured hot loop that owns its buffer, with a value outside the key domain,
  and restore any slot it overwrites. *[CLRS ch. 10; Algorithms Unlocked ch. 2]*

## Graphs

- **Store sparse graphs as adjacency lists; use a matrix only when the graph is
  dense or constant-time edge tests dominate.** A matrix costs V² space whatever
  the edge count, and stating cost in V alone hides that trade-off.
  *[CLRS ch. 22; Algorithms Unlocked ch. 1, 5; DSAME-Java ch. 9]*
- **Pick the shortest-path algorithm from edge-weight properties:** BFS for
  unit weights, relaxation in topological order for DAGs, Dijkstra only for
  non-negative weights, Bellman-Ford otherwise, and A* for point-to-point
  queries with a good admissible heuristic. With negative weights, detect and
  report negative cycles rather than loop or return garbage.
  *[CLRS ch. 24; Algorithms Unlocked ch. 5, 6; DSAME-Java ch. 9]*
- **Model "must happen before" constraints as a DAG and topologically sort
  them; if not every node is output, report the cycle.** Do not assume the
  order is unique. *[Algorithms Unlocked ch. 5; DSAME-Java ch. 9; CLRS ch. 1]*
- **Use BFS for fewest-edge paths and shallow targets; use DFS when memory is
  tight, the target is deep, or you need ordering or cycle detection.** Input
  edge order decides visit order, so tests must not depend on it unless that
  order is fixed on purpose. *[DSAME-Java ch. 9]*
- **Run single-source searches from the vertices you need instead of
  all-pairs.** For true all-pairs, use Floyd-Warshall on moderate dense graphs
  and Johnson's or repeated Dijkstra on large sparse ones.
  *[Algorithms Unlocked ch. 6; CLRS ch. 25]*

## Design techniques: DP, greedy, divide and conquer, backtracking

- **Reduce a new problem to a known one before inventing an algorithm,** such
  as sort-then-scan, shortest paths, LCS, or a linear program, and check that
  the conversion costs less than what it feeds.
  *[DSAME-Java ch. 16; CLRS ch. 1]*
- **Use dynamic programming only after confirming optimal substructure and
  overlapping subproblems.** Without overlap, plain divide and conquer
  suffices; without substructure, combined answers are wrong.
  *[CLRS ch. 15; Algorithms Unlocked ch. 7; DSAME-Java ch. 19]*
- **Do not assume optimal substructure because a problem looks like one that
  has it.** Shortest simple paths have it; longest simple paths do not.
  *[CLRS ch. 15]*
- **Choose bottom-up tables when every subproblem is needed and memoization
  when only a fraction is reached.** Watch recursion depth in memoized code,
  mark "not yet computed" with a distinct flag rather than a value such as 0,
  and use a value type wide enough for the results.
  *[CLRS ch. 15; DSAME-Java ch. 19]*
- **Store the choice at each subproblem when you need the solution, not just
  its value; shrink to a rolling window when you need only the value.**
  *[CLRS ch. 15; Algorithms Unlocked ch. 6; DSAME-Java ch. 19]*
- **Use greedy only after showing the greedy choice is always safe, and test it
  against an exhaustive or DP oracle on small inputs.** Fractional knapsack is
  greedy-solvable; 0-1 knapsack is not.
  *[CLRS ch. 16; DSAME-Java ch. 17, 19]*
- **In divide and conquer, stop at a reasonably large base case and solve it
  directly; do not split work a simple loop already does.**
  *[DSAME-Java ch. 18; CLRS ch. 2]*
- **In backtracking, prune options that cannot lead to a valid solution before
  recursing.** Pruning is what keeps it from trying every combination.
  *[DSAME-Java ch. 2]*

## Hard problems, approximation, and limits

- **For NP-hard optimisation, use branch and bound, local search, or an
  approximation algorithm, and state its factor in the docstring and tests.**
  "Correct" then means "within that factor of optimal", and the factor does not
  carry over to a related problem through a reduction.
  *[Algorithms Unlocked ch. 1, 10; CLRS ch. 35; DSAME-Java ch. 16]*
- **Enforce a hard input-size limit for any exponential algorithm, parsed and
  rejected at the boundary.** An oversized request should fail fast with a
  clear message, not hang. *[DSAME-Java ch. 20; Review lessons]*
- **Use a probabilistic algorithm only when its error rate is bounded, tunable,
  and written in its contract; prefer one-sided error.** A primality test that
  can only wrongly say "prime" qualifies; one whose error rate is unknown does
  not. *[Algorithms Unlocked ch. 1; CLRS ch. 31]*

## Strings and pattern matching

- **Preprocess a pattern once and match in linear time (KMP or a library
  routine) for heavy or repeated matching.** Naive matching costs about n
  times m. *[Algorithms Unlocked ch. 7]*
- **In a rolling-hash matcher, update the hash in O(1) per shift and confirm
  every hash match by comparing characters,** as with any fast pre-filter.
  *[CLRS ch. 32; DSAME-Java ch. 15]*
- **Escape user-supplied text before building a regular expression from it.**
  The regular-expressions file has the rest. *[Review lessons]*

## Randomness, numerics, and geometry

- **Shuffle with Fisher-Yates or the platform shuffle, and test shuffles by the
  frequency of whole permutations, not per position.** Drawing from the whole
  array at every step biases the result, and per-position uniformity does not
  imply a uniform permutation. *[CLRS ch. 5]*
- **Use fixed seeds only for reproducible tests; draw keys, tokens, and IVs
  from the OS CSPRNG.** Crypto rules live in the security file. *[Algorithms Unlocked ch. 8]*
- **Use library routines for primality and modular powers.** If hand-written,
  use Miller-Rabin with several random bases, not one Fermat test, and repeated
  squaring with a reduction after each step. Generate crypto keys only with a
  vetted crypto library. *[CLRS ch. 31; Algorithms Unlocked ch. 8]*
- **Solve linear systems with a factorisation or library solver, never by
  inverting the matrix, and compute integral answers in integer arithmetic.**
  Inversion and floating-point transforms amplify round-off. *[CLRS ch. 28, 30]*
- **Write geometric predicates with cross products and comparisons, not slopes,
  division, or trigonometry, and handle collinear and touching cases.**
  *[CLRS ch. 33]*

## Parallel work

- **Predict parallel scalability from work and span, not from timings on
  today's core count.** Time on P processors is roughly work/P plus span.
  *[CLRS ch. 27]*
- **Make parallel iterations independent and coarsen leaf tasks to cover
  scheduling overhead.** Use per-task accumulators and a reduction; races and
  locking belong in the concurrency file. *[CLRS ch. 27; DSAME-Java ch. 18]*

## Tensions

- **Textbook quicksort vs library hybrid sorts.** The sources present quicksort
  with random pivots as the practical choice. Current libraries use hybrids
  with cutoffs and worst-case fallbacks built in: introsort in common C++
  libraries, pdqsort in Go 1.19+, new stable and unstable sorts in Rust 1.81+, a
  Timsort-family merge sort for Python and Java objects, and dual-pivot
  quicksort for Java primitives. Call the library sort and check its stability;
  the quicksort rules are for judging code, not a mandate to reimplement.
  *[CLRS ch. 7; Algorithms Unlocked ch. 3; DSAME-Java ch. 10; Java SE 21 Arrays;
  Go 1.19 release notes; Rust 1.81.0 release]*
- **Prime table sizes vs power-of-two tables.** CLRS advises a prime modulus;
  many modern tables use power-of-two sizes for speed. Either is fine when the
  hash mixes all bits well; the all-bits rule always holds. *[CLRS ch. 11]*
- **Load-factor limits.** One source allows ten or twenty entries per chain;
  common implementations rehash far earlier (Java `HashMap` at 0.75, and it
  turns long chains into trees), and open-addressing limits vary by probing
  scheme. Follow library defaults; when hand-rolling, keep open-address tables
  strictly below full. *[DSAME-Java ch. 14; CLRS ch. 11]*
- **Worst-case guarantees vs practical speed.** CLRS says design for the worst
  case, yet defends simplex and quicksort. Default to a worst-case bound on
  untrusted input; accept a bad worst case only with randomization or trusted
  input, and name the inputs that would trigger it. *[CLRS ch. 2, 7, 29]*
- **Asymptotic bounds vs cache behaviour.** The RAM model makes linked lists
  and BSTs look as good as arrays and B-trees, and linked containers avoid
  resize spikes. On modern hardware the contiguous structure usually wins;
  default to it, pre-size when pauses matter, and measure before choosing the
  pointer-heavy option. *[Algorithms Unlocked ch. 2; DSAME-Java ch. 3, 4]*
- **Dated crypto in the algorithm texts.** Algorithms Unlocked shows CBC and RSA
  key transport; current practice is AEAD with unique nonces and ephemeral key
  agreement, via vetted libraries and the security file. *[Algorithms Unlocked ch. 8]*

## Sources

- **CLRS**: Introduction to Algorithms (Cormen, Leiserson, Rivest, Stein, 3rd ed.)
- **Algorithms Unlocked**: Algorithms Unlocked (Thomas H. Cormen)
- **DSAME-Java**: Data Structures and Algorithms Made Easy in Java (Narasimha Karumanchi)
- **Review lessons**: rules distilled from the maintainer's code-review findings
- **Python Sorting Techniques**: Python documentation, Sorting Techniques (<https://docs.python.org/3/howto/sorting.html>)
- **Java SE 21 Arrays**: Java SE 21 API, `java.util.Arrays` (<https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/Arrays.html>)
- **MDN Array.prototype.sort**: MDN Web Docs, Array.prototype.sort() (<https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/sort>)
- **cppreference std::stable_sort**: cppreference, std::stable_sort (<https://en.cppreference.com/w/cpp/algorithm/stable_sort>)
- **Go slices package**: Go standard library, package slices (<https://pkg.go.dev/slices>)
- **Go 1.19 release notes**: Go 1.19 Release Notes (<https://go.dev/doc/go1.19>)
- **Rust 1.81.0 release**: Rust Blog, Announcing Rust 1.81.0 (<https://blog.rust-lang.org/2024/09/05/Rust-1.81.0/>)
