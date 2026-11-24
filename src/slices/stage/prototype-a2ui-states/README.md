# PROTOTYPE: how a surface's later states look (#702)

Throwaway. Never merged.

**Question:** how do a surface's later states look: locked, queued, over the limit, reopened and waiting?

Run `pnpm install`, then `pnpm proto:a2ui-states`. A guide at the bottom walks through the steps. Each
one offers different takes with one marked recommended, and the last screen has the picks to copy.

- The looks settled in #696 are fixed here: header-bar frame, listed questions, review rail, live strip.
- The shell is a mock, and picks are saved only in the browser.
- Raw surfaces run through the official engine (`@a2ui/react` 0.16.1, strict mode). Questions, reviews and
  boards are plain React.
- In the last step "Reload Quay's window" is simulated: what would be lost is cleared and the rest is
  kept in the page. It proves nothing about Rust holding the text.
- The waiting dot and the Agents badge in the module bar are drawn as Quay draws them today.
