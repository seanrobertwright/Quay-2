# Contributing practices

This library is read by AI coding agents. `AGENTS.md` is loaded every session
and routes the agent to files under `practices/` only when the task needs them.
Every file therefore has to earn its tokens: an agent should be able to stop
reading after the first section and still act well.

## Practice file format

```markdown
# <Title>

> **Load when:** <the tasks, file types, or questions that make this file relevant>
> **See also:** [<title>](../<dir>/<file>.md), ...

## Top rules

1. **<Imperative rule.>** <Why, in one clause.> *[<Key> ch. N]*
2. ...

## <Subtopic>

- **<Imperative rule.>** <Why, or the condition under which it applies.> *[<Key> ch. N]*
- ...

## Tensions

- **<Position A> vs <position B>.** <Which one this library takes, and when the
  other one wins.> *[<Key>; <Key>]*

## Sources

- **<Key>**: <Full title (authors, edition)>
```

## Rules for rules

- **Imperative and checkable.** "Validate request bodies with a schema parser at
  the handler boundary", not "think about validation". A reviewer should be
  able to point at code and say whether it follows the rule.
- **Aimed at an agent writing code.** Drop advice that only applies to hiring,
  career growth, or org charts unless it changes how code gets written,
  reviewed, or shipped.
- **One idea per bullet.** Lead with the rule in bold; keep the bullet to one or
  two sentences.
- **Paraphrase.** The sources are copyrighted books. Never quote more than a
  short phrase, and never reproduce code listings, tables, or figures.
- **Cite by key and chapter or section name**, not page number: pages differ
  between editions and formats. Web sources cite the page title as the key and
  give the URL in Sources.
- **Merge duplicates.** When several sources say the same thing, write one rule
  and cite all of them.
- **Record disagreements in Tensions** with the position this library takes.
  Do not silently pick a side.
- **Flag dated advice.** If a source predates a major change (for example
  Kafka's move from ZooKeeper to KRaft, Spring Boot 2 to 3, Java 8 to 21),
  either update the rule to current practice and say so, or drop it.
- **No `file:line` references, absolute paths, personal names other than
  authors, email addresses, or hand-typed counts.**
- **Size.** Aim for 150 to 350 lines. If a file needs more, split it into a
  directory and add the new files to the routing table in `AGENTS.md`.

## Adding a file

1. Write the file in the format above under the matching `practices/<area>/`.
2. Add a row to the routing table in `AGENTS.md` with a precise "load when".
3. Add any new sources to `SOURCES.md`.
