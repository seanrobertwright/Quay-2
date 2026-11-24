# PROTOTYPE: what each job's surface looks like in its place (#696)

Throwaway. Never merged.

**Question:** what does each job's surface look like in its place?

Run `pnpm install`, then `pnpm proto:a2ui-look`. A guide at the bottom walks through the steps. Each one
offers different takes with one marked recommended, and the last screen has the picks to copy.

- The shell is a mock, and nothing is saved outside the browser.
- Ask, review and board are plain React in Quay's classes, filled with the fields #698 fixed, at an
  ordinary size and near each limit.
- Raw surfaces are A2UI 1.0 messages run through the official engine (`@a2ui/react` 0.15.0 in strict
  mode) with Quay's own components registered under the basic catalog's id. They use Text, Column, Row,
  Card, Button, TextField, CheckBox and Slider.
- The Markdown renderer is a stand-in for `@a2ui/markdown-it`. Links do not open.
- The Antigravity path and entry in the Connect step are placeholders, not checked against the CLI.
