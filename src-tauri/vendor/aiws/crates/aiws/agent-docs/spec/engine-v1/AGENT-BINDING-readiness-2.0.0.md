# Agent binding: readiness 2.0.0

The built readiness 2.0.0 section of `spec/engine-v1/AGENT-BINDING.md`. The rest of that contract is specified but not built, and is not in this pack.

- `readiness.schema.json` becomes 2.0.0 (`$id` `https://aiws.dev/readiness/2.0.0`) with
  profiles `aiws-capabilities/2`, `aiws-requirements/2`, `aiws-capability-snapshot/2`,
  `aiws-readiness-binding/2` and `aiws-readiness/2`. `readiness.schema-1.0.0.json` is frozen
  beside it.
- The SDKs decode both versions and encode 2.0.0, and the parity scripts cover both. This is SDK
  0.4.0. Each SDK carries 2.0.0 as `readiness.schema.json` and 1.0.0 as
  `readiness.schema-1.0.0.json`; its exported readiness types describe 2.0.0, and `v1` holds the
  1.0.0 types. SDK readiness evaluation stays 1.0.0 only. The engine evaluates a run under the
  version its binding names; a 2.0.0 evaluation uses the check statuses, reasons and remediation
  of 1.0.0 unchanged, as §2 (not in this pack) requires for `MODEL`, and returns an
  `aiws-readiness/2` report.
- What changes in 2.0.0: the manifest drops `provider` and `model` and gains `modelSet`,
  `configuration`, `usageReporting` and `gaps`; the capability kind `MODEL` is added with the
  names in §2 (not in this pack), VERIFIED only; and
  `implementationDigest` covers adapter code and tool binary only.
- **SDK reach.** Readiness 2.0.0 is the only part of this contract that SDK 0.4.0 carries, in TypeScript, Rust and Python. Everything else in this contract
  is a source-only engine profile, marked so in the capability matrix.

