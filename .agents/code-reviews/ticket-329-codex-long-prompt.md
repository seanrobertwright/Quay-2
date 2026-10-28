# Code review: ticket 329, long A2A message to Codex not submitted

**Stats:**

- Files Modified: 2
- Files Added: 0
- Files Deleted: 0
- New lines: 44
- Deleted lines: 5

## Scope

`PtyManager::submit_prompt` now types End (`ESC [ F`) after a prompt to a Codex
terminal and before its Enter. Two router tests now expect the extra write.

## Checked

- **Cause.** Codex's `PasteBurst` (`codex-rs/tui/src/bottom_pane/paste_burst.rs`)
  turns an Enter that comes within `PASTE_ENTER_SUPPRESS_WINDOW` (120 ms) of the
  last processed burst character into a newline. A ConPTY harness on Codex
  0.164.0 showed 500 characters take about 380 ms before the composer redraws,
  so an Enter written 250 ms after the text arrives inside the window. The
  composer's non-text-key branch calls `flush_before_modified_input` and then
  `clear_window_after_non_char`, so End ends both the burst and the window.
- **Measured.** Same harness, Enter 250 ms after the text: plain typing failed
  for 500 characters (2 of 2 runs) and for 2000 characters even at 1000 ms.
  Text, then End as its own write, then Enter submitted for 40, 500 (3 runs),
  700, 2000 (2 runs) and 4000 characters. The 700-character run got its `OK`
  answer and left the composer empty.
- **Locking.** `get_info` takes and releases `terminals_info` while the
  per-terminal submit lock is held. No other path takes those two locks in the
  reverse order, so there is no new lock-order risk.
- **Errors.** A failed End write returns an error, so `type_in` in the router
  puts the terminal's status back as it does for a failed Enter.
- **Router turn matching.** End is its own write, so the first write is still
  the exact text the router stores and compares with Codex's reported prompt.
- **Other callers.** Machina's `send_to_author` goes through `submit_prompt`,
  so Codex authors get the fix too.

## Issues

severity: low
file: src-tauri/src/slices/pty/manager.rs
line: 526
issue: End is sent to Codex only; other CLIs keep text, then Enter.
detail: Only Codex was measured and the ticket reports Claude Code unaffected.
  Other TUIs that detect paste bursts would need the same treatment, but none
  is known to.
suggestion: None for this change. Extend the check per CLI if another one shows
  the symptom.

Code review passed. No technical issues detected.
