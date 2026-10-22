# Python

> **Load when:** writing, reviewing, refactoring, or debugging Python code
> (`*.py`, `pyproject.toml`, `requirements*.txt`), designing Python functions,
> classes, exceptions, or package layout, adding type hints or a type checker,
> parsing CLI flags, env vars, files, or JSON in Python, writing threaded or
> asyncio code, or choosing Python tooling (venv, linters, packaging).
> **See also:** [Code and module design](../core/code-design.md),
> [Object-oriented design patterns and SOLID](../design/design-patterns.md),
> [Testing](../testing/testing.md),
> [Concurrency and parallelism](../concurrency/concurrency.md),
> [Application and API security](../security/application-security.md),
> [Regular expressions](../tools/regular-expressions.md),
> [Debugging](../core/debugging.md),
> [Continuous integration and delivery](../devops/ci-cd.md),
> [Machine learning systems](../ml/ml-systems.md)

## Top rules

1. **Never use a mutable object as a parameter default; default to `None`
   and build a fresh object in the body.** The default is evaluated once, so
   every call shares and corrupts one object. *[Fluent Python ch. 6; Python
   Distilled ch. 5, Default Arguments]*
2. **Parse external input at the boundary with a runtime validator; type
   hints and `TypedDict` enforce nothing, and `assert` is no validator.**
   Hints have no runtime effect and `assert` is stripped under `-O`.
   *[Fluent Python ch. 8, ch. 15, TypedDict; Python Distilled ch. 3,
   Assertions; Review lessons]*
3. **Catch the narrowest exception that covers the expected failure, only
   where a decision can be made, and chain with `raise ... from err`.** A
   broad `except Exception` swallows real bugs. *[Python Distilled ch. 3,
   Exception Handling Advice; Chained Exceptions]*
4. **Acquire every resource (file, lock, connection, temp dir) in a `with`
   block; never rely on `__del__` for cleanup.** Exceptions skip manual
   release code, and `__del__` runs at unpredictable times. *[Python Distilled
   ch. 3, ch. 7, Object Life Cycle; Fluent Python ch. 18]*
5. **Pass `encoding="utf-8"` to every text-mode `open()` and text-mode
   `subprocess.run`, and keep bytes and `str` apart: decode on input, encode
   on output.** The default encoding varies by platform and locale. *[Fluent
   Python ch. 4, Encoding Defaults; Python Distilled ch. 9, Text Encoding]*
6. **Test a missing optional argument with `is None`, never truthiness; use
   `is` only for `None`, other singletons, and sentinels.** `if not items:`
   silently replaces a caller's empty list. *[Fluent Python ch. 6, == and is;
   Python Distilled ch. 2, Object Comparison]*
7. **Copy a mutable argument before storing or mutating it, unless mutating
   the caller's object is the documented contract.** Arguments are shared, not
   copied. *[Fluent Python ch. 6, Defensive Programming with Mutable
   Parameters; Python Distilled ch. 4, References and Copies]*
8. **Never block inside a coroutine; offload blocking I/O or CPU work with
   `asyncio.to_thread` or an executor.** One `time.sleep` or synchronous HTTP
   call freezes the whole event loop. *[Fluent Python ch. 19, ch. 21, The
   All-or-Nothing Problem]*
9. **Never unpickle untrusted data or pass untrusted text to `eval`, `exec`,
   or `shell=True`.** Each can run arbitrary code. *[Python Distilled ch. 9,
   Object Serialization; Review lessons]*
10. **Run a linter (for example ruff) and a type checker (mypy or pyright) in
    CI, and never disable a correctness rule globally.** Suppress one rule on
    one line or file, with a reason.
    *[Fluent Python ch. 8, Imperfect Typing and Strong Testing; Python
    Distilled ch. 5, Type Hints; Review lessons]*

## Functions and arguments

- **Make boolean flags and tuning options keyword-only (after `*`).**
  `load(path, True)` is unreadable; `strict=True` documents the call.
  *[Python Distilled ch. 5, Keyword Arguments]*
- **Return `None` from functions that mutate in place, a new object from those
  that do not.** This is the `list.sort` versus `sorted` convention. *[Fluent
  Python ch. 2; Python Distilled ch. 5, Parameter Passing]*
- **Avoid `global` and mutable module state; keep state on an object or read
  it as `module.name`.** `from mod import name` copies the binding, so later
  reassignment in `mod` is never seen. *[Python Distilled ch. 5, Scoping
  Rules; ch. 8]*
- **Bind loop variables at definition time in closures (`lambda x=x: ...` or
  `functools.partial`).** Free variables are looked up at call time, so every
  closure sees the final value. *[Python Distilled ch. 5, The lambda
  Expression]*
- **Decorate every decorator's inner wrapper with `@functools.wraps(func)`.**
  Without it the function loses its name, docstring, and signature. *[Fluent
  Python ch. 9; Python Distilled ch. 5, Decorators]*
- **Use `functools.lru_cache(maxsize=N)` in long-running processes; keep
  unbounded `functools.cache` for short scripts.** An unbounded cache grows
  until memory runs out. *[Fluent Python ch. 9, Memoization]*
- **Replace long `isinstance`/`elif` chains with a dict dispatch table or
  `functools.singledispatch` registered on ABCs.** *[Fluent Python ch. 9,
  Single Dispatch; Python Distilled ch. 7, Type-Based Dispatch]*
- **Write single-method strategies, commands, and callbacks as plain
  functions, not classes with one `run()` method.** *[Fluent Python ch. 10;
  Python Distilled ch. 7, Avoiding Inheritance via Functions]*
- **Make every docstring claim ("never raises", "newest first", "at most
  one") match the code exactly, and update it in the same change.** *[Review
  lessons]*

## Errors and exceptions

- **Let an exception propagate from code that cannot act on it.** A handler
  that logs and continues only hides the failure. *[Python Distilled ch. 3,
  Exception Handling Advice]*
- **Define one application base exception and raise subclasses of it for
  intentional errors.** Your own type means a known condition; a built-in
  `TypeError` points to a bug. *[Python Distilled ch. 3, Defining New
  Exceptions]*
- **Keep a `try` block to the one call that can raise; put follow-up code in
  `else`.** Otherwise the handler catches errors it never meant to guard.
  *[Fluent Python ch. 18, else Blocks Beyond if]*
- **Prefer EAFP (`try` the operation) over check-then-act with `in`,
  `hasattr`, or `os.path.exists`.** The check and the action race. *[Fluent
  Python ch. 18; ch. 13, Defensive Programming]*
- **Raise rather than return `None` when a function cannot produce a
  result.** A `None` return pushes a forgettable check onto every caller.
  *[Python Distilled ch. 5, Error Handling]*
- **Fail fast at the top of a function by converting arguments (`list(arg)`,
  `iter(arg)`) or checking them.** The error then surfaces near the faulty
  call. *[Fluent Python ch. 13, Defensive Programming and "Fail Fast"]*

## Parsing input at the boundary

- **Validate env vars, CLI flags, query params, and request bodies with one
  parser (argparse `type=` callables, pydantic, or a `parse_*` helper) that
  fails fast with a message naming the input.** Scattered `int()` calls give
  tracebacks, not actionable errors. *[Review lessons; Fluent Python ch. 15]*
- **Reject non-finite numbers explicitly.** `float()` accepts `"nan"` and
  `"inf"`, and `json.loads` accepts `NaN` and `Infinity` unless you pass
  `parse_constant`; check `math.isfinite` and range. *[Review lessons]*
- **Reject empty and whitespace-only strings; `int()` strips whitespace and
  accepts underscores and non-ASCII digits.** Match a strict pattern first
  when the format is fixed. *[Review lessons]*
- **Parse ids with `uuid.UUID(s)` inside `try`, and compare with the canonical
  form when only that form is valid.** `UUID()` also accepts braces, a
  `urn:uuid:` prefix, and missing hyphens. *[Review lessons]*
- **Escape ids and user values with `re.escape` before building a regex.**
  *[Review lessons]*
- **Sanitize attribute names that come from data before `setattr`/`getattr`:
  map keywords (`keyword.iskeyword`), reject non-identifiers
  (`str.isidentifier`), refuse names that shadow methods.** *[Fluent Python
  ch. 22, Exploring JSON-Like Data]*
- **Use `field(default_factory=...)` for mutable dataclass defaults, and
  validate fields in `__post_init__` or at the boundary.** Dataclass
  annotations are not checked at runtime. *[Fluent Python ch. 5]*

## Data, mutability, and collections

- **Build nested lists with a comprehension, never `[[0] * n] * m`.** The
  outer multiplication repeats one inner list. *[Fluent Python ch. 2, Building
  Lists of Lists]*
- **Use `copy.deepcopy` only when you will mutate nested data that must stay
  independent.** Copies are shallow by default, but `deepcopy` is slow and
  fails on files, sockets, and generators. *[Fluent Python ch. 6; Python
  Distilled ch. 4, References and Copies]*
- **Choose the container for the access pattern: `set` for membership,
  `deque` for queues, `array` or NumPy for millions of numbers.** `in` on a
  list is linear. *[Fluent Python ch. 2, When a List Is Not the Answer]*
- **Iterate lazily with generators when the consumer loops once, and split
  deep nested loops into a pipeline of small generator functions.** Each stage
  takes any iterable and tests alone; a generator is consumed only once.
  *[Fluent Python ch. 17; Python Distilled ch. 2, ch. 6, Generators in
  Practice]*
- **Make `__iter__` return a new iterator per call; never make a collection
  its own iterator.** Otherwise only one traversal runs at a time. *[Fluent
  Python ch. 17]*
- **Prefer comprehensions and reducing built-ins (`sum`, `any`,
  `max(key=...)`) over `map`/`filter` with `lambda`.** *[Fluent Python ch. 2,
  ch. 7]*
- **Give every query or API listing a limit or pagination, stream large
  results instead of building lists, and hoist expensive derivations out of
  loops.** Size for production row counts, not the fixture. *[Review lessons]*

## Text, files, processes, and HTTP

- **Normalize text (usually NFC) before comparing or keying on it, and use
  `str.casefold()` for case-insensitive matching.** *[Fluent Python ch. 4;
  Python Distilled ch. 9, unicodedata]*
- **Separate parsing and data production from the I/O itself.** A parser fed
  byte chunks works with files, sockets, and asyncio and tests without fakes.
  *[Python Distilled ch. 9, Generating Output; Consuming Input]*
- **Load package data with `importlib.resources.files(...)`, not paths built
  from `__file__`.** Updated from the book's `pkgutil.get_data`. *[Python
  Distilled ch. 8, Package Data]*
- **Write secrets with owner-only permissions to a uniquely named file
  (`tempfile.mkstemp`, or `os.open` with mode `0o600`).** Never use a
  predictable relative path. *[Review lessons]*
- **Run subprocesses with an argument list and `shell=False`; if shell text is
  unavoidable, quote with `shlex.quote` and validate names put in `export` or
  `eval` as identifiers.** *[Review lessons]*
- **Give every outbound HTTP call that carries a token an explicit timeout,
  and disable redirects.** `requests` has no default timeout. *[Review
  lessons; Fluent Python ch. 20]*

## Dates and times

- **Route all date and time handling through one project helper module.**
  Scattered `datetime.now()` and parsing mix naive and aware values. *[Review
  lessons]*
- **Use aware datetimes (`datetime.now(timezone.utc)`); never `utcnow()`,
  deprecated since 3.12, which returns a naive value.** *[Review lessons]*
- **Attach an explicit zone to timezone-less strings from `fromisoformat` or
  `strptime`, and never compute "today" with `date.today()` or by slicing
  `isoformat()` outside the helper.** Both use process-local time. *[Review
  lessons]*

## Type hints

- **Annotate parameters with the most abstract type needed (`Iterable`,
  `Mapping`) and returns with concrete types (`list[str]`).** `dict[str, int]`
  on a parameter rejects `ChainMap` for no reason. *[Fluent Python ch. 8]*
- **Write optional parameters as `x: T | None = None`, with built-in generics
  (`list[int]`).** Updated from `Optional[T]` and `typing.List`. *[Fluent
  Python ch. 8, Using None as a Default]*
- **On 3.12+ use PEP 695 generics (`def first[T](xs: Sequence[T]) -> T`),
  plus `typing.Self`, `@override`, and `@final` where they apply.** These
  postdate both books. *[Fluent Python ch. 8, ch. 15 (updated)]*
- **Keep `typing.Protocol` interfaces narrow and define them next to the code
  that consumes them.** Narrow protocols cut coupling and make test fakes
  trivial. *[Fluent Python ch. 13, Best Practices for Protocol Design]*
- **Use `typing.cast` and `# type: ignore[code]` only for checker or stub
  defects, each with a comment saying why.** `cast` does nothing at runtime.
  *[Fluent Python ch. 15, Type Casting]*
- **Read annotations through one wrapper over `typing.get_type_hints` or, on
  3.14+, `annotationlib.get_annotations`; never `__annotations__`.**
  Annotation evaluation became deferred in 3.14. *[Fluent Python ch. 15]*

## Classes and object design

- **Start with plain public attributes; add a `property` later only for
  validation or computation, assigning through it in `__init__`.** Callers do
  not change; Java-style getters are ceremony. *[Fluent Python ch. 11; Python
  Distilled ch. 7, Properties]*
- **Give every class a `__repr__` that shows its state and uses
  `type(self).__name__`.** Add `__str__` only for a distinct user display.
  *[Fluent Python ch. 1; Python Distilled ch. 4, On Being Pythonic]*
- **Implement the special methods built-ins expect (`__len__`, `__iter__`,
  `__eq__`) instead of `size()` or `get_item()`, but only those callers
  need.** *[Fluent Python ch. 1, ch. 11]*
- **Define `__eq__` and `__hash__` together from read-only fields, and return
  `NotImplemented` (never raise) for unsupported operands.** Prefer
  `@dataclass(frozen=True)`; operators return new objects. *[Fluent Python ch.
  11, ch. 16; Python Distilled ch. 4, Comparison Protocol]*
- **Write alternate constructors as `@classmethod`s that call `cls(...)`;
  prefer module functions to `@staticmethod`.** *[Fluent Python ch. 11; Python
  Distilled ch. 7, Class Methods]*
- **Mark internals with one leading underscore; use `__name` mangling only to
  avoid subclass clashes.** Neither is a security boundary. *[Fluent Python ch.
  11; Python Distilled ch. 7, Private Attributes]*
- **Create all attributes in `__init__`; add `__slots__` only for very many
  instances, redeclared in every subclass.** *[Fluent Python ch. 3, ch. 11;
  Python Distilled ch. 7, `__slots__`]*
- **Accept collaborators (clients, stores, policies) as constructor arguments
  instead of hard-wiring them.** Tests can then pass fakes. *[Python Distilled
  ch. 7, Composition]*

## Inheritance and metaprogramming

- **Prefer composition and delegation; subclass only classes designed for
  extension.** A stack built by subclassing `list` exposes `sort` and
  `insert`. *[Fluent Python ch. 14, Coping with Inheritance; Python Distilled
  ch. 7, Composition]*
- **Subclass `collections.UserDict`/`UserList` or a `collections.abc` ABC,
  never `dict`, `list`, or `str`.** C built-ins bypass overrides:
  `dict.update` ignores your `__setitem__`. *[Fluent Python ch. 3, ch. 14;
  Python Distilled ch. 7]*
- **Declare required interfaces with `abc.ABC` and `@abstractmethod` or a
  `Protocol`, not methods that raise `NotImplementedError`.** An ABC refuses
  to instantiate an incomplete subclass. *[Python Distilled ch. 7; Fluent
  Python ch. 13, Goose Typing]*
- **Name mixins `...Mixin`, keep them stateless, and call `super()` in every
  cooperating method.** A direct `Base.method(self)` breaks the MRO chain.
  *[Fluent Python ch. 14; Python Distilled ch. 7, Mixins]*
- **Use class decorators, `__init_subclass__`, or `__set_name__` before a
  metaclass.** Metaclasses conflict with each other, including `ABCMeta`.
  *[Fluent Python ch. 24; Python Distilled ch. 7]*
- **Write `match` class patterns with parentheses (`case float():`).** A bare
  name is a capture pattern that matches anything. *[Fluent Python ch. 5]*

## Concurrency and async

- **Use threads or asyncio for I/O waits and `ProcessPoolExecutor` for
  CPU-bound Python, via `concurrent.futures`.** On the default GIL build,
  threads slow pure-Python computation; the free-threaded build (supported
  from 3.14) is opt-in. *[Fluent Python ch. 19, ch. 20]*
- **Start with `asyncio.run()` and structure tasks with `asyncio.TaskGroup`
  and `asyncio.timeout()` (3.11+).** These replace Python Distilled's
  `get_event_loop()` calls (an error with no current loop on 3.14) and the
  bare `gather` both books show. *[Fluent Python ch. 21; Python Distilled ch. 9
  (updated)]*
- **Bound fan-out with an `asyncio.Semaphore` or executor `max_workers`, and
  time out every network request.** *[Fluent Python ch. 21, Throttling]*
- **Call `.result()` on every future and handle expected per-item errors in
  the worker.** Exceptions surface only through `.result()`. *[Fluent Python
  ch. 20, Error Handling]*
- **Guard shared state with a `Lock` in `with`, pass work through
  `queue.Queue`, and stop threads with a `threading.Event`.** Threads cannot
  be killed from outside. *[Python Distilled ch. 9, threading; Fluent Python
  ch. 19]*
- **Enforce "only one" or "never twice" in the database, not with an
  in-process lock.** Each worker process holds its own lock. *[Review lessons]*
  See [SQL and query performance](../data/sql-and-query-performance.md).

## Packaging and tooling

- **Start non-throwaway programs as a package run with `python -m pkg`, with
  `main(argv)` behind `if __name__ == "__main__":`.** Passing `argv` makes the
  entry point testable. *[Python Distilled ch. 8, Start with a Package; ch. 1]*
- **Describe the project in a `pyproject.toml` `[project]` table with a PEP
  517 build backend; never `setup.py` plus `distutils`, removed in 3.12.**
  *[Python Distilled ch. 8 (updated)]*
- **Install dependencies into a virtual environment, never the system Python,
  and commit a lockfile (`uv.lock`, `poetry.lock`, or PEP 751
  `pylock.toml`).** *[Python Distilled ch. 1 (updated)]*
- **Use relative imports inside a package, never `import *` outside an
  `__init__.py` with `__all__`, and fix import cycles by moving shared code to
  a new module.** *[Python Distilled ch. 8]*
- **Use `logging.getLogger(__name__)` in modules, configure logging once at
  startup, and pass values as arguments (`log.info("got %s", n)`).** *[Python
  Distilled ch. 9, logging]*
- **Treat unused imports and dead code as lint errors; scope suppressions to
  one line (`# noqa: CODE`) with a reason.** *[Review lessons]*
- **After fixing a defect, grep for the same pattern (mutable default, bare
  `except`, `open()` without `encoding=`) and fix every sibling in the same
  commit.** *[Review lessons]*

## Tensions

- **Hints optional vs typed everywhere.** Both books treat hints as optional.
  This library types public APIs and new code and runs a checker in CI;
  hints never replace runtime validation or tests. *[Fluent Python; Python
  Distilled]*
- **Data class as code smell vs data classes as DTOs.** Use `@dataclass` and
  pydantic freely for config and boundary records, but move logic that
  scatters around them into the class. *[Fluent Python]*
- **Avoid inheritance vs framework-imposed inheritance.** Subclass where the
  framework demands it (Django, SQLAlchemy); compose everywhere else.
  *[Fluent Python; Python Distilled]*
- **Avoid async vs async-first frameworks.** Default to sync for scripts and
  batch jobs; follow the framework in FastAPI or Starlette stacks. *[Python
  Distilled; Fluent Python]*
- **EAFP vs validating up front.** Use EAFP for operations on resources you
  touch, and up-front parsing for external input. *[Fluent Python; Review
  lessons]*
- **Explicit `encoding=` vs UTF-8 mode by default.** PEP 686 makes UTF-8 the
  default from 3.15; keep the argument while any supported version predates
  it. *[Fluent Python; Python Distilled]*

## Sources

- **Fluent Python**: Fluent Python, 2nd Edition (Luciano Ramalho; O'Reilly,
  2022; covers Python 3.10)
- **Python Distilled**: Python Distilled (David M. Beazley; Addison-Wesley,
  2022; written against Python 3.9)
- **Review lessons**: rules distilled from the maintainer's code-review
  findings
