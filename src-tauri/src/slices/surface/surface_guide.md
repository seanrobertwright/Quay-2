# Raw surfaces

How to write a call of quay_surface: A2UI 1.0 messages in Quay's own catalog, which is not the standard's basic one. quay_ask asks questions, quay_review shows a plan or findings and quay_board shows progress with far less to write. Use them where they do.

## A call to copy

```json
{"place":"companion","title":"Run the migration","messages":[
{"version":"1.0","createSurface":{"surfaceId":"confirm","components":[
{"id":"root","component":"Column","children":["ask","run"]},
{"id":"ask","component":"Text","text":"Run the migration on the **staging** database now?"},
{"id":"run","component":"Button","variant":"primary","child":"run_label","action":{"event":{"name":"run","context":{}}}},
{"id":"run_label","component":"Text","text":"Run it"}]}}]}
```

- Change its texts, ids and title, and add components from the lines below.
- Each message is `{"version": "1.0"}` with one kind of message. `components` is one flat list, and exactly one component in it has the id `root`.
- A parent names its children by id, in `children` or a Button's `child`. Each child is a component of its own in the list, never written inside its parent.
- When the operator presses the Button, its `event` is sent to you: the call waits for it.

## The call

- A call is `{"place", "title", "messages"}`. `messages` is a list of one or more messages, written out in the call and never left empty.
- A message is `{"version": "1.0"}` with one of `createSurface: {surfaceId, dataModel?, components}`, `updateComponents: {surfaceId, components}`, `updateDataModel: {surfaceId, path?, value}` and `deleteSurface: {surfaceId}`. Any other message is rejected.
- A call that creates needs a `place` and a `title` of at most 80 characters of plain text. Both are fixed for the surface's life: a later call leaves them out or repeats them.
- `companion` is narrow, beside the terminal, for something that needs an answer. `tab` is full width, opened by the operator, for long content. `strip` is compact, on the pane, for status, and may have no action to you.
- At most one `createSurface` a call. You may have four live surfaces in each place.
- You choose the `surfaceId`. Ids are your terminal's own, and surfaces that quay_ask, quay_review and quay_board make have theirs among them.
- Leave out `catalogId`: Quay fills it in. `theme` and `sendDataModel` are rejected.
- The call returns `{"shown": true}` at once when no Button of the surface has an action to you, and `{"deleted": true}` when it only deletes. Otherwise it waits up to 100 seconds and returns `{"version": "1.0", "action": {"name", "surfaceId", "sourceComponentId", "timestamp", "context"}}`.
- On `"state": "no_answer_yet"` end your turn. Do not call again or ask in other words: the same creating call only waits again, and other words are rejected or make one more surface. The answer is typed into this terminal, and quay_surface_read returns it too.
- On `{"dismissed": true}` the operator closed the surface. Stop updating it.

## A surface

- Each component is `{"id", "component", ...its properties}` in one flat list. Children are named by id, never written inside their parent.
- Exactly one has the id "root". Every other is a child of one that is there, every id that is named is there, and nothing is its own ancestor. This holds of the whole surface after every call, though not between its messages.
- A component's id is letters, digits and underscores, with no digit first: `step_2`, not `step-2`.
- A property that is not in the component's line is rejected, as is a wrong type: where the line says string, 3 is `"3"`. Any component also takes `@accessibility: {label?, description?}`.
- Version 1.0 writes `@path`, `@call`, `@checks` and `@accessibility` with the @. A binding is always `@path`. A list template, `updateDataModel` and some lines below have a plain `path`, which is not a binding.
- At most 500 components, 12 images and 256 kB of data model. The data model is an object. `/frame` in it is Quay's: neither set nor bind it.
- At most 2000 components drawn at once, and 10000 with every row drawn. A list draws 100 rows at once. What a template draws counts for each row and a component each time it is named, so a list in a list multiplies. Each option, step and tab counts as one.
- A component counts as one more for each 250 characters of text, 8 tokens of Markdown (a link has 16 more than it is written in), 4 bindings and calls, or 1000 characters of JSON, by the one it has most of. Markdown always counts, plain text where it is bound or drawn more than once, JSON where it is drawn more than once. A list counts as one more for each 10000 characters of the data of 100 rows, and each component under it for each 100 characters of an id or of a list's path.

## Updates and deletes

- An update carries whole components: each one in it replaces the one with its id, so send all its properties, also those that stay.
- An update cannot remove a component. Left out of its parent's list it has no parent, and the update is rejected. Delete the surface and create it again in one call.
- To add one, send it together with its parent, whose list names it.
- To change what is shown, bind it to the data model and send `updateDataModel` with the `path` that changed. With no `path`, or `/`, it replaces the whole model.
- An update keeps what the operator has put in, except at the paths it sets, under them and above them, and where too much would then be drawn.
- An update to a surface that was answered opens it again, and the call waits again.
- A surface that quay_ask, quay_review or quay_board made takes no update: call its tool again. `deleteSurface` takes back any of them.

## Errors

A rejected call returns an error, `{"errors": [{"code", "surfaceId", "path", "message"}], "next"}`. `path` is a JSON Pointer into your call. Nothing in the call was done, not even the messages that were right: correct it and send all of it again.

## Types

- `?` may be left out, `= x` is its default, `a|b` are the values it may have, `[]` is a list and `[2+]` one of two or more.
- `binding`: `{"@path": "/a/b"}`, a place in the data model. In a template a path with no / first is the item's own: `{"@path": "name"}`.
- `call`: `{"@call": "required", "args": {"value": ...}}`, of a function below.
- `string~` and the others with a ~: the value, a binding or a call.
- `id`: one component's id.
- `children`: a list of ids, or a template `{"componentId": id, "path": "/list"}` that is drawn once for each item.
- `check`: `{"condition": a binding or a call, "message": text}`. A validationResult counts as a boolean.
- `action`: `{"event": {"name", "context": {...}}}` is sent to you, with each binding in `context` as its value. `{"functionCall": call}` runs a function with an effect.

## Components

Text(text: string~, variant?: caption|body = body, weight?: number)
Image(url: string~, description?: string~, fit?: contain|cover|fill|none|scaleDown = fill, variant?: icon|avatar|smallFeature|mediumFeature|largeFeature|header = mediumFeature, weight?: number)
Icon(name: accountCircle|add|arrowBack|arrowForward|attachFile|calendarToday|call|camera|check|close|delete|download|edit|event|error|fastForward|favorite|favoriteOff|folder|help|home|info|locationOn|lock|lockOpen|mail|menu|moreVert|moreHoriz|notificationsOff|notifications|pause|payment|person|phone|photo|play|print|refresh|rewind|search|send|settings|share|shoppingCart|skipNext|skipPrevious|star|starHalf|starOff|stop|upload|visibility|visibilityOff|volumeDown|volumeMute|volumeOff|volumeUp|warning|{svgPath: string~}|binding, weight?: number)
Row(children: children, justify?: center|end|spaceAround|spaceBetween|spaceEvenly|start|stretch = start, align?: start|center|end|stretch = stretch, weight?: number) A layout component that arranges its children horizontally.
Column(children: children, justify?: start|center|end|spaceBetween|spaceAround|spaceEvenly|stretch = start, align?: center|end|start|stretch = stretch, weight?: number) A layout component that arranges its children vertically.
List(children: children, direction?: vertical|horizontal = vertical, align?: start|center|end|stretch = stretch, weight?: number)
Card(child: id, weight?: number)
Tabs(tabs: {title: string~, child: id}[1+], weight?: number)
Divider(axis?: horizontal|vertical = horizontal, weight?: number)
Button(@checks?: check[], child: id, variant?: default|primary|borderless = default, action: action, weight?: number)
TextField(@checks?: check[], label: string~, value: string~, placeholder?: string~, variant?: longText|number|shortText|obscured = shortText, weight?: number)
CheckBox(@checks?: check[], label: string~, value: boolean~, weight?: number)
ChoicePicker(@checks?: check[], label?: string~, variant?: multipleSelection|mutuallyExclusive = mutuallyExclusive, options: {label: string~, value: string, description?: string, recommended?: boolean}[], value: string[]~, displayStyle?: checkbox|chips = checkbox, filterable?: boolean = false, weight?: number) A component that allows selecting one or more options from a list.
Slider(@checks?: check[], label?: string~, min?: number = 0, max: number, value: number~, steps?: integer >= 1, weight?: number)
DateTimeInput(@checks?: check[], value: string~, enableDate?: boolean = false, enableTime?: boolean = false, min?: string~, max?: string~, label?: string~, weight?: number)
Progress(done: number~, total: number~, label?: string~)
Steps(steps: {label: string, state: pending|active|done|failed, note?: string}[]|binding)
Stat(label: string~, value: string~)
FileLink(path: string~, line?: number~, label?: string~)

## Functions

required(value: any~): validationResult. Checks that the value is not null, undefined, or empty.
regex(value: string~, pattern: string): validationResult. Checks that the value matches a regular expression string.
length(value: string~, min?: integer >= 0, max?: integer >= 0): validationResult. Checks string length constraints.
numeric(value: number~, min?: number, max?: number): validationResult. Checks numeric range constraints.
email(value: string~): validationResult. Checks that the value is a valid email address.
formatString(value: string~): string. Performs string interpolation of data model values and other functions in the catalog functions list and returns the resulting string.
formatNumber(value: number~, decimals?: number~, grouping?: boolean~): string. Formats a number with the specified grouping and decimal precision.
formatCurrency(value: number~, currency: string~, decimals?: number~, grouping?: boolean~): string. Formats a number as a currency string.
formatDate(value: any~, format: string~): string. Formats a timestamp into a string using a pattern.
pluralize(value: number~, zero?: string~, one?: string~, two?: string~, few?: string~, many?: string~, other: string~): string. Returns a localized string based on the Common Locale Data Repository (CLDR) plural category of the count (zero, one, two, few, many, other).
and(values: boolean~[2+]): boolean. Performs a logical AND operation on a list of boolean values.
or(values: boolean~[2+]): boolean. Performs a logical OR operation on a list of boolean values.
not(value: boolean~): boolean. Performs a logical NOT operation on a boolean value.
openUrl(url: string~): void. Opens the specified URL in a browser or handler (requires user activation).
showFile(path: string~, line?: number~): void. Shows a file in its folder, or its changes when it has uncommitted ones.
focusTerminal(terminal: string~): void. Selects a terminal of the surface's own project.
copyText(text: string~): void. Puts a text on the clipboard.
@index(offset?: number~): number.

## What Quay does with them

- Inputs: bind `value` to a path, and put that path in the `context` of your Button's event. You get the `context` and nothing else of what the operator put in.
- A failing check tells the operator what is wrong at its input. It holds a Button only when that Button has it too.
- Text is Markdown. There are no heading variants: write `## Title`. A `diff` block is tinted, raw HTML is shown as text.
- Button has no label of its own: its child is a Text, or an Icon with an `@accessibility` label.
- ChoicePicker's value is a list, also where one may be picked. `recommended` is a mark and picks nothing.
- DateTimeInput takes and gives ISO 8601, and the empty string for none.
- Image's `url` is the path of a PNG, JPEG, GIF or WebP file on this computer, up to 10 MB. Nothing is loaded from the network.
- A path is absolute or relative to this terminal's working directory, and never a network path.
- `weight` is the share of a Row's or Column's room. For a component without it, put it in a Column that has one.
- These run only as a Button's action, on the operator's click: openUrl, showFile, focusTerminal, copyText. openUrl takes http and https. focusTerminal takes the id or exact name of a terminal of this project.
- formatString fills in `${/a/b}`, `${name}` in a template, and calls: `${formatNumber(value:${/n}, decimals:1)}`. `\${` is a plain `${`. Its `value` is text or bound to text, never a call, and a text it fills in may not lead back to itself.
- formatDate takes patterns such as `yyyy-MM-dd HH:mm` and `MMM d, h:mm a`. length and numeric need `min`, `max` or both. regex takes no lookbehind, backreference or named group.
- @index works in a template only, and counts from 0.
- Quay draws no Modal, Video or AudioPlayer.

## Examples

A form that waits for the operator. The Button has the check too, or it would send an empty branch.

```json
{"place":"companion","title":"Release branch","messages":[
{"version":"1.0","createSurface":{"surfaceId":"release","dataModel":{"branch":"","size":[],"day":"","notify":false},"components":[
{"id":"root","component":"Column","children":["intro","branch","size","day","notify","buttons"]},
{"id":"intro","component":"Text","text":"`master` is **3 commits** ahead. What should I cut?"},
{"id":"branch","component":"TextField","label":"Branch","placeholder":"release/1.4","value":{"@path":"/branch"},"@checks":[{"condition":{"@call":"required","args":{"value":{"@path":"/branch"}}},"message":"A branch is needed."}]},
{"id":"size","component":"ChoicePicker","label":"Size","value":{"@path":"/size"},"options":[{"label":"Small","value":"small","description":"Fixes only","recommended":true},{"label":"Large","value":"large"}]},
{"id":"day","component":"DateTimeInput","label":"Not before","enableDate":true,"value":{"@path":"/day"}},
{"id":"notify","component":"CheckBox","label":"Tell the other agents","value":{"@path":"/notify"}},
{"id":"buttons","component":"Row","children":["cut","skip"]},
{"id":"cut","component":"Button","variant":"primary","child":"cut_label","action":{"event":{"name":"cut","context":{"branch":{"@path":"/branch"},"size":{"@path":"/size"},"day":{"@path":"/day"},"notify":{"@path":"/notify"}}}},"@checks":[{"condition":{"@call":"required","args":{"value":{"@path":"/branch"}}},"message":"A branch is needed."}]},
{"id":"cut_label","component":"Text","text":"Cut it"},
{"id":"skip","component":"Button","child":"skip_label","action":{"event":{"name":"skip","context":{}}}},
{"id":"skip_label","component":"Text","text":"Not now"}]}}]}
```

A report in a tab: a list drawn from data, and a Button that opens a page.

```json
{"place":"tab","title":"Call sites of parseDate","messages":[
{"version":"1.0","createSurface":{"surfaceId":"report","dataModel":{"sites":[{"file":"src/lib/dates.ts","line":42,"uses":3},{"file":"src/App.tsx","line":7,"uses":1}]},"components":[
{"id":"root","component":"Column","children":["head","sites","docs"]},
{"id":"head","component":"Text","text":"## Four calls in two files\n\nEach reads a date with **no zone**."},
{"id":"sites","component":"List","children":{"componentId":"site","path":"/sites"}},
{"id":"site","component":"Card","child":"site_row"},
{"id":"site_row","component":"Row","align":"center","children":["number","file","uses"]},
{"id":"number","component":"Text","text":{"@call":"@index","args":{"offset":1}}},
{"id":"file","component":"FileLink","path":{"@path":"file"},"line":{"@path":"line"}},
{"id":"uses","component":"Text","text":{"@call":"formatString","args":{"value":"${uses} ${pluralize(value:${uses}, one:'use', other:'uses')}"}},"variant":"caption"},
{"id":"docs","component":"Button","variant":"borderless","child":"docs_label","action":{"functionCall":{"@call":"openUrl","args":{"url":"https://tc39.es/proposal-temporal/docs/"}}}},
{"id":"docs_label","component":"Text","text":"Read about Temporal"}]}}]}
```

Status in a strip, drawn from data.

```json
{"place":"strip","title":"Nightly import","messages":[
{"version":"1.0","createSurface":{"surfaceId":"import","dataModel":{"done":120,"steps":[{"label":"Download","state":"done"},{"label":"Import","state":"active","note":"table 3"}]},"components":[
{"id":"root","component":"Column","children":["bar","steps"]},
{"id":"bar","component":"Progress","label":"Rows","done":{"@path":"/done"},"total":400},
{"id":"steps","component":"Steps","steps":{"@path":"/steps"}}]}}]}
```

Later, one value changes and a Stat is added. `root` is sent whole, with the new child in its list.

```json
{"messages":[
{"version":"1.0","updateDataModel":{"surfaceId":"import","path":"/done","value":260}},
{"version":"1.0","updateComponents":{"surfaceId":"import","components":[
{"id":"root","component":"Column","children":["bar","steps","failed"]},
{"id":"failed","component":"Stat","label":"failed","value":"2"}]}}]}
```

To take components away, delete the surface and create it again in one call. This one also takes the report back.

```json
{"place":"strip","title":"Nightly import, done","messages":[
{"version":"1.0","deleteSurface":{"surfaceId":"report"}},
{"version":"1.0","deleteSurface":{"surfaceId":"import"}},
{"version":"1.0","createSurface":{"surfaceId":"import","components":[
{"id":"root","component":"Text","text":"Imported **398** of 400 rows."}]}}]}
```
