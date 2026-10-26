# Token Spend & Cost Telemetry

Autonomous AI coding agents consume millions of tokens during large refactors, architectural sweeps, and continuous test cycles. **Quay 2** includes a high-performance **Token Spend Meter** (`Ctrl+Shift+B T`) to track your exact expenditure across all active and historical sessions.

---

## High-Performance Transcript Scanner

Rather than relying on outdated static cache files, Quay 2 scans Claude Code's raw JSON Lines transcripts stored in `~/.claude/projects/**/*.jsonl`.

### Message Deduplication Engine
During streaming agent turns, Claude Code writes multiple partial JSONL lines for each turn (thinking blocks, text fragments, tool calls). Naive scanners count these multiple times, dramatically inflating reported token counts.

Quay 2's Rust scanner:
1. Deduplicates entries by unique `message.id`.
2. Extracts final `usage.input_tokens`, `usage.output_tokens`, `usage.cache_creation_input_tokens`, and `usage.cache_read_input_tokens`.
3. Caches file modification timestamps (`mtime`) and file sizes in `%LOCALAPPDATA%\Quay2\token_stats_cache.json`.
4. Subsequent scans complete in under **2 milliseconds**, providing instant startup and live updates.

---

## Pricing Rates Matrix

Quay 2 calculates costs using official Anthropic API pricing tiers:

| Model ID | Input Tokens ($ / M) | Output Tokens ($ / M) | Cache Write ($ / M) | Cache Read ($ / M) |
| :--- | :---: | :---: | :---: | :---: |
| **`claude-opus-5-5`** | $15.00 | $75.00 | $18.75 | $1.50 |
| **`claude-sonnet-5-5`** | $3.00 | $15.00 | $3.75 | $0.30 |
| **`claude-haiku-5-5`** | $0.80 | $4.00 | $1.00 | $0.08 |
| **`claude-opus-4-6`** | $15.00 | $75.00 | $18.75 | $1.50 |
| **`claude-sonnet-4-6`** | $3.00 | $15.00 | $3.75 | $0.30 |

---

## Live Spend Pill in Navigation Rail

At the bottom of the navigation rail, Quay 2 displays your live cumulative spend:
```text
[🪙 $42.18]   ^⇧b n · ^⇧b 1..9   🟢 ConPTY
```
Clicking the spend pill (or pressing `Ctrl+Shift+B T`) opens the detailed telemetry modal, featuring:
- Total sessions scanned.
- Total input, output, and cached token counts.
- Cost breakdown by model.
- Turn audio chime configuration.
