// What the guide says besides its generated lines, written by hand: how a call is made, what a surface may
// be, how the lines are read, and what they leave out.
import { EFFECTS } from "../effects.ts";
import { inKb, MOST_COMPONENTS, MOST_DATA, MOST_IMAGES } from "../raw/postCheck.ts";

const list = (...rules: string[]): string => rules.map((rule) => `- ${rule}`).join("\n");

export const OPENING =
  "How to write a call of quay_surface: A2UI 1.0 messages in Quay's own catalog, which is not the standard's basic one. quay_ask asks questions, quay_review shows a plan or findings and quay_board shows progress with far less to write. Use them where they do.";

export const CALL = list(
  'A call is `{"place", "title", "messages"}`. `messages` is a list of one or more messages, written out in the call and never left empty.',
  'A message is `{"version": "1.0"}` with one of `createSurface: {surfaceId, dataModel?, components}`, `updateComponents: {surfaceId, components}`, `updateDataModel: {surfaceId, path?, value}` and `deleteSurface: {surfaceId}`. Any other message is rejected.',
  "A call that creates needs a `place` and a `title` of at most 80 characters of plain text. Both are fixed for the surface's life: a later call leaves them out or repeats them.",
  "`companion` is narrow, beside the terminal, for something that needs an answer. `tab` is full width, opened by the operator, for long content. `strip` is compact, on the pane, for status, and may have no action to you.",
  "At most one `createSurface` a call. You may have four live surfaces in each place.",
  "You choose the `surfaceId`. Ids are your terminal's own, and surfaces that quay_ask, quay_review and quay_board make have theirs among them.",
  "Leave out `catalogId`: Quay fills it in. `theme` and `sendDataModel` are rejected.",
  'The call returns `{"shown": true}` at once when no Button of the surface has an action to you, and `{"deleted": true}` when it only deletes. Otherwise it waits up to 100 seconds and returns `{"version": "1.0", "action": {"name", "surfaceId", "sourceComponentId", "timestamp", "context"}}`.',
  'On `"state": "no_answer_yet"` end your turn. Do not call again or ask in other words: the same creating call only waits again, and other words are rejected or make one more surface. The answer is typed into this terminal, and quay_surface_read returns it too.',
  'On `{"dismissed": true}` the operator closed the surface. Stop updating it.',
);

export const SURFACE = list(
  'Each component is `{"id", "component", ...its properties}` in one flat list. Children are named by id, never written inside their parent.',
  'Exactly one has the id "root". Every other is a child of one that is there, every id that is named is there, and nothing is its own ancestor. This holds of the whole surface after every call, though not between its messages.',
  "A component's id is letters, digits and underscores, with no digit first: `step_2`, not `step-2`.",
  "A property that is not in the component's line is rejected, as is a wrong type: where the line says string, 3 is `\"3\"`. Any component also takes `@accessibility: {label?, description?}`.",
  "Version 1.0 writes `@path`, `@call`, `@checks` and `@accessibility` with the @. A binding is always `@path`. A list template, `updateDataModel` and some lines below have a plain `path`, which is not a binding.",
  `At most ${MOST_COMPONENTS} components, ${MOST_IMAGES} images and ${inKb(MOST_DATA)} of data model. The data model is an object. \`/frame\` in it is Quay's: neither set nor bind it.`,
);

export const UPDATES = list(
  "An update carries whole components: each one in it replaces the one with its id, so send all its properties, also those that stay.",
  "An update cannot remove a component. Left out of its parent's list it has no parent, and the update is rejected. Delete the surface and create it again in one call.",
  "To add one, send it together with its parent, whose list names it.",
  "To change what is shown, bind it to the data model and send `updateDataModel` with the `path` that changed. With no `path`, or `/`, it replaces the whole model.",
  "An update keeps what the operator has put in, except at the paths it sets, under them and above them.",
  "An update to a surface that was answered opens it again, and the call waits again.",
  "A surface that quay_ask, quay_review or quay_board made takes no update: call its tool again. `deleteSurface` takes back any of them.",
);

export const ERRORS =
  'A rejected call returns an error, `{"errors": [{"code", "surfaceId", "path", "message"}], "next"}`. `path` is a JSON Pointer into your call. Nothing in the call was done, not even the messages that were right: correct it and send all of it again.';

export const TYPES = list(
  "`?` may be left out, `= x` is its default, `a|b` are the values it may have, `[]` is a list and `[2+]` one of two or more.",
  '`binding`: `{"@path": "/a/b"}`, a place in the data model. In a template a path with no / first is the item\'s own: `{"@path": "name"}`.',
  '`call`: `{"@call": "required", "args": {"value": ...}}`, of a function below.',
  "`string~` and the others with a ~: the value, a binding or a call.",
  "`id`: one component's id.",
  '`children`: a list of ids, or a template `{"componentId": id, "path": "/list"}` that is drawn once for each item.',
  '`check`: `{"condition": a binding or a call, "message": text}`. A validationResult counts as a boolean.',
  '`action`: `{"event": {"name", "context": {...}}}` is sent to you, with each binding in `context` as its value. `{"functionCall": call}` runs a function with an effect.',
);

export const NOTES = list(
  "Inputs: bind `value` to a path, and put that path in the `context` of your Button's event. You get the `context` and nothing else of what the operator put in.",
  "A failing check tells the operator what is wrong at its input. It holds a Button only when that Button has it too.",
  "Text is Markdown. There are no heading variants: write `## Title`. A `diff` block is tinted, raw HTML is shown as text.",
  "Button has no label of its own: its child is a Text, or an Icon with an `@accessibility` label.",
  "ChoicePicker's value is a list, also where one may be picked. `recommended` is a mark and picks nothing.",
  "DateTimeInput takes and gives ISO 8601, and the empty string for none.",
  "Image's `url` is the path of a PNG, JPEG, GIF or WebP file on this computer, up to 10 MB. Nothing is loaded from the network.",
  "A path is absolute or relative to this terminal's working directory, and never a network path.",
  "`weight` is the share of a Row's or Column's room. For a component without it, put it in a Column that has one.",
  `These run only as a Button's action, on the operator's click: ${EFFECTS.map(({ name }) => name).join(", ")}. openUrl takes http and https. focusTerminal takes the id or exact name of a terminal of this project.`,
  "formatString fills in `${/a/b}`, `${name}` in a template, and calls: `${formatNumber(value:${/n}, decimals:1)}`. `\\${` is a plain `${`.",
  "formatDate takes patterns such as `yyyy-MM-dd HH:mm` and `MMM d, h:mm a`. length and numeric need `min`, `max` or both. regex takes no lookbehind, backreference or named group.",
  "@index works in a template only, and counts from 0.",
  "Quay draws no Modal, Video or AudioPlayer.",
);
