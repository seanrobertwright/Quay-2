// A surface that holds every component of Quay's catalog, as an agent would write one.
import { text, type Component } from "./rawFixtures.ts";

const at = (path: string) => ({ "@path": path });
const required = (path: string, message: string) => ({ "@checks": [{ condition: { "@call": "required", args: { value: at(path) } }, message }] });

/** The components of the root Column, in order. */
export const ALL_CHILDREN = ["head", "line", "tabs", "list", "strip", "buttons"];

export const ALL_DATA: Record<string, unknown> = {
  name: "",
  when: "2026-10-21T14:06:11+02:00",
  size: 4,
  picked: ["rebase"],
  chips: [],
  agreed: false,
  done: 3,
  steps: [
    { label: "Find the call sites", state: "done", note: "41 files" },
    { label: "Change them", state: "active" },
    { label: "Run the suite", state: "failed" },
    { label: "Open the pull request", state: "pending" },
  ],
  files: [
    { path: "src/slices/surface/a2ui/catalog.ts", lines: 42 },
    { path: "docs/a-page-with-a-rather-long-name-that-does-not-fit-a-narrow-place-in-one-line.md", lines: 7 },
  ],
};

const OPTIONS = [
  { label: "Rebase onto master", value: "rebase", description: "Keeps one line of history", recommended: true },
  { label: "Merge master", value: "merge", description: "Keeps both, with a merge commit" },
  { label: "Leave it as it is", value: "leave" },
];

export const ALL_COMPONENTS: Component[] = [
  { id: "head", component: "Row", justify: "spaceBetween", align: "center", children: ["head_icon", "head_text", "head_stat"] },
  { id: "head_icon", component: "Icon", name: "info", "@accessibility": { label: "Note" } },
  { ...text("head_text", "Three **call sites** are left in `src/slices/surface`, of which one is [documented](https://quay.example/docs)."), weight: 1 },
  { id: "head_stat", component: "Stat", label: "passed", value: "186" },
  { id: "line", component: "Divider" },
  {
    id: "tabs",
    component: "Tabs",
    "@accessibility": { label: "Parts of the plan" },
    tabs: [
      { title: "The form", child: "form" },
      { title: "How it stands", child: "state" },
      { title: "What was read along the way", child: "notes" },
    ],
  },
  { id: "form", component: "Column", children: ["name", "secret", "notes_field", "way", "extras", "size", "pair", "agree"] },
  { id: "name", component: "TextField", label: "Branch", placeholder: "ticket-726", value: at("/name"), ...required("/name", "A branch is needed.") },
  { id: "secret", component: "TextField", variant: "obscured", label: "Passphrase", value: "" },
  { id: "notes_field", component: "TextField", variant: "longText", label: "Notes", value: at("/notes") },
  { id: "way", component: "ChoicePicker", label: "Which way should this branch catch up?", options: OPTIONS, value: at("/picked") },
  { id: "extras", component: "ChoicePicker", label: "And also", variant: "multipleSelection", displayStyle: "chips", filterable: true, options: OPTIONS, value: at("/chips"), ...required("/chips", "Pick one at least.") },
  { id: "size", component: "Slider", label: "Files in one commit", min: 1, max: 20, value: at("/size") },
  { id: "pair", component: "Row", children: ["when", "day"] },
  { id: "when", component: "DateTimeInput", label: "Not before", enableDate: true, enableTime: true, value: at("/when"), weight: 1 },
  { id: "day", component: "DateTimeInput", label: "Day", enableDate: true, value: at("/day"), weight: 1 },
  { id: "agree", component: "CheckBox", label: "Push the branch when it is done, and open a pull request for it", value: at("/agreed"), "@checks": [{ condition: at("/agreed"), message: "Say so first." }] },
  { id: "state", component: "Card", child: "state_column" },
  { id: "state_column", component: "Column", children: ["steps", "bar"] },
  { id: "steps", component: "Steps", steps: at("/steps") },
  { id: "bar", component: "Progress", done: at("/done"), total: 7, label: "Files" },
  text("notes", "| Step | Time | Note |\n| --- | ---: | --- |\n| Find | 4 | a long note that takes more room than a narrow place has |"),
  { id: "list", component: "List", children: { componentId: "file", path: "/files" } },
  { id: "file", component: "Card", child: "file_row" },
  { id: "file_row", component: "Row", children: ["file_number", "file_link", "file_rule", "file_lines"] },
  text("file_number", { "@call": "@index", args: { offset: 1 } }),
  { id: "file_link", component: "FileLink", path: at("path") },
  { id: "file_rule", component: "Divider", axis: "vertical" },
  text("file_lines", { "@call": "formatString", args: { value: "${lines} lines" } }),
  { id: "strip", component: "List", direction: "horizontal", align: "center", children: ["shot", "shot_card", "shot_card_2"] },
  { id: "shot", component: "Image", url: "https://quay.example/a.png", description: "What the window looked like" },
  { id: "shot_card", component: "Card", child: "shot_text" },
  text("shot_text", "One of two cards that lie beside each other"),
  { id: "shot_card_2", component: "Card", child: "shot_text_2" },
  text("shot_text_2", "The other of the two cards"),
  { id: "buttons", component: "Row", children: ["send", "open", "copy", "focus", "more"] },
  { id: "send", component: "Button", variant: "primary", child: "send_text", action: { event: { name: "send", context: { name: at("/name") } } } },
  text("send_text", "Send the plan to the agent that asked for it"),
  { id: "open", component: "Button", variant: "borderless", child: "open_text", action: { functionCall: { "@call": "openUrl", args: { url: "https://quay.example/docs/surfaces?from=plan" } } } },
  text("open_text", "Read about it"),
  { id: "copy", component: "Button", child: "copy_text", action: { functionCall: { "@call": "copyText", args: { text: "git rebase master" } } } },
  text("copy_text", "Copy the command"),
  { id: "focus", component: "Button", child: "focus_text", action: { functionCall: { "@call": "focusTerminal", args: { terminal: "server" } } } },
  text("focus_text", "Show the server"),
  { id: "more", component: "Button", child: "more_icon", action: { functionCall: { "@call": "showFile", args: { path: "README.md" } } } },
  { id: "more_icon", component: "Icon", name: "moreHoriz" },
];
