# What the official A2UI React renderer gives Quay

Research note for issue #684 (map: #682). Researched 2026-11-23.

**Gist.** `@a2ui/react` is at 0.15.0 on npm, not 0.9.1, and it already renders A2UI 1.0 surfaces on React 19. It is a thin React shell (11 kB) over `@a2ui/web_core` (about 465 kB minified with the basic catalog), and its basic catalog is Lit custom elements styled by CSS variables, not React components. Quay can keep the official protocol engine and register its own Tailwind-styled React components under the basic catalog's id, which leaves 18 components to write instead of a whole renderer. The npm release predates the 2026-11-11 rename of the component envelope keys, so it rejects `@accessibility`, `@checks` and `@catalogId`; the fix is in 0.16.0, which is in the repository but not yet on npm.

Each finding is marked **W** (well supported: read in the primary source, or run by me) or **T** (tentative: source not read in full, sources conflict, or an inference of mine).

## Sources

Repository paths are in `a2ui-project/a2ui` at commit `5ff1b05` (2026-11-20). `github.com/google/A2UI` redirects to that repository.

| Short name | Source | Read |
| :-- | :-- | :-- |
| React README | [`typescript/renderers/react/README.md`](https://github.com/a2ui-project/a2ui/blob/5ff1b05/typescript/renderers/react/README.md) | In full |
| React changelog | [`typescript/renderers/react/CHANGELOG.md`](https://github.com/a2ui-project/a2ui/blob/5ff1b05/typescript/renderers/react/CHANGELOG.md) | In full |
| React source | [`typescript/renderers/react/`](https://github.com/a2ui-project/a2ui/tree/5ff1b05/typescript/renderers/react): `package.json`, `src/index.ts`, `src/A2uiSurface.tsx`, `src/catalog/prepare_catalogs.ts` | Those files; the rest by file list and line count |
| Core changelog | [`typescript/core/web_core/CHANGELOG.md`](https://github.com/a2ui-project/a2ui/blob/5ff1b05/typescript/core/web_core/CHANGELOG.md) | Every entry that mentions 1.0, and the release headings |
| Core source | [`typescript/core/web_core/src/`](https://github.com/a2ui-project/a2ui/tree/5ff1b05/typescript/core/web_core/src): `catalogs/basic/v1/`, `universal/basic_catalog/styles/default.ts`, `universal/basic_catalog/components/Button.ts`, `catalog/types.ts` (the `Catalog` class) | Those files; the rest by file list and line count |
| Published packages | npm tarballs `@a2ui/react@0.15.0` and `@a2ui/web_core@0.15.0`: manifests, README, type declarations for `MessageProcessor` and `ValidationConfig` | Those files |
| npm registry | `registry.npmjs.org` for `@a2ui/react`, `@a2ui/web_core`, `@a2ui/lit`, `@a2ui/angular` | Queried 2026-11-23 |
| Probe | My own runs of the published 0.15.0 packages with React 19.1.0 in Node 24 and happy-dom, and esbuild bundles | First hand; scripts not kept in the repository |
| Client guide | [`guides/client-integration.mdx`](https://github.com/a2ui-project/a2ui/blob/5ff1b05/docs/site/src/content/docs/guides/client-integration.mdx), published at <https://a2ui.org/guides/client-integration/> | In full |
| SDKs page | [`concepts/sdks.mdx`](https://github.com/a2ui-project/a2ui/blob/5ff1b05/docs/site/src/content/docs/concepts/sdks.mdx) | Renderer and core sections |
| Catalogs page | [`concepts/catalogs.mdx`](https://github.com/a2ui-project/a2ui/blob/5ff1b05/docs/site/src/content/docs/concepts/catalogs.mdx) | "Registering a catalog in a renderer" (React tab) and "The basic catalog" |
| Roadmap | [`roadmap.mdx`](https://github.com/a2ui-project/a2ui/blob/5ff1b05/docs/site/src/content/docs/roadmap.mdx) | In full |
| Community page | [`ecosystem/renderers.mdx`](https://github.com/a2ui-project/a2ui/blob/5ff1b05/docs/site/src/content/docs/ecosystem/renderers.mdx) | In full |
| Spec | [`specification/v1_0/docs/a2ui_protocol.md`](https://github.com/a2ui-project/a2ui/blob/5ff1b05/specification/v1_0/docs/a2ui_protocol.md) | Outline, and the sections on changes, function calls, failure rules, accessibility and the basic catalog |
| Basic catalog | [`catalogs/basic/v1/catalog.json`](https://github.com/a2ui-project/a2ui/blob/5ff1b05/catalogs/basic/v1/catalog.json) | Parsed in full: components, properties, enums, functions |
| Announcement | <https://developers.googleblog.com/a2ui-10-build-delightful-fast-reliable-agentic-experiences/> (2026-11-11) | Through a fetch tool that extracts quotes, not the raw page |
| Quay | `package.json` and `src-tauri/tauri.conf.json` at `origin/master` (`301d9d3`) | Dependencies and the CSP block |

Not read: the defining-a-catalog guide beyond its headings, the universal web components guide, the basic catalog implementation guide, the React renderer's `node-view.tsx` and `adapter.tsx`, the Lit and Angular renderers, the blueprints, and any community renderer's code.

## 1. Version and what it renders

1. **`@a2ui/react` is at 0.15.0, published 2026-11-02. W.** The registry lists 0.8.0 (2026-03-17), 0.9.0, 0.9.1 (2026-04-17), 0.10.0 to 0.10.2, 0.11.0, 0.11.1, 0.12.0, 0.13.0, 0.14.0 and 0.15.0. The only dist-tag is `latest`. `@a2ui/web_core` and `@a2ui/lit` are also at 0.15.0.
2. **The published 0.15.0 renders a 1.0 surface. W, by running it.** With React 19.1.0 I fed `createSurface`, `updateComponents` and `updateDataModel` messages carrying `"version": "1.0"`, the 1.0 basic catalog id and `@path` bindings. The surface rendered, a click on the `Button` delivered `{"name":"approve","surfaceId":"s1","sourceComponentId":"b","timestamp":…,"context":{"plan":"P-7"}}` to the action handler, and a later `updateDataModel` changed the text in place. A single `createSurface` carrying `components` and `dataModel` was also accepted.
3. **1.0 support arrived in October, before the announcement. W.** Core 0.13.0 (2026-10-09) added the 1.0 basic catalog elements. React 0.13.0 made the package root a version-agnostic runtime, and React 0.14.0 (2026-10-17) carries the first `(v1_0)` entry.
4. **The published 0.15.0 rejects the final 1.0 spelling of the component envelope keys. W, by running it.** `@accessibility`, `@checks` and `@catalogId` on a component each fail with `Unrecognized key(s) in object`. The bare spellings `accessibility`, `checks` and `catalogId` are accepted. The 1.0 schema ([`common_types.json`](https://github.com/a2ui-project/a2ui/blob/5ff1b05/specification/v1_0/json/common_types.json)) uses the `@` forms since commit [`24d1bf9`](https://github.com/a2ui-project/a2ui/commit/24d1bf9) of 2026-11-11. An agent that follows the published 1.0 schema therefore breaks the npm release as soon as it sets an accessibility label or a check.
5. **The fix is in 0.16.0, which is not on npm. W.** The repository's `package.json` files say 0.16.0, and the core changelog's 0.16.0 entry emits the `@` keys and still reads the bare ones. The version bump landed on 2026-11-18 (commit "chore(release): bump npm package versions for release (#4294)"). The registry still showed 0.15.0 on 2026-11-23. I found no published date for the npm release. The gaps between the last five releases were 16, 11, 8 and 16 days, so 0.16.0 is plausibly days away. **T** for that guess.
6. **The 0.16.0 README claims 0.9, 0.9.1 and 1.0 from one package, with 0.8 as a legacy entry point. W.** "Renders A2UI v0.9, v0.9.1 and v1.0 surfaces from the same package." The processor "accepts messages for every supported protocol version (v0.8, v0.9, v0.9.1 and v1.0)". Only the catalog import differs by version. `@a2ui/react/v0_8` is a separate, deprecated renderer. The README inside the 0.15.0 tarball still says "v0.9 Native" and does not mention 1.0, so the npm page understates what the package does.
7. **The SDK version is below 1.0 although the protocol is 1.0, and most minor releases break something. W.** In the React changelog 0.9.1, 0.10.0, 0.11.0, 0.13.0, 0.15.0 and 0.16.0 each carry entries marked BREAKING CHANGE, and the core changelog has many more.
8. **The official documentation tracks the repository, not npm. W for the mismatch found, T as a general rule.** The client guide tells React users to install "react and react-dom ^17.0.0 || ^18.0.0 || ^19.0.0", which is the 0.16.0 range. The guide's 1.0 imports from `@a2ui/web_core/v1_0` do resolve in 0.15.0.

## 2. React 19, dependencies, size

9. **React 19 is supported. W.** The 0.15.0 manifest declares peers `react` and `react-dom` at `^18.0.0 || ^19.0.0` and `zod` at `^3.25.76`. The package is developed against React `^19.2.7`. The probe ran on 19.1.0, the version Quay declares. 0.16.0 widens the range to React 17.
10. **It brings these runtime dependencies. W.** `@a2ui/react`: `@a2ui/web_core`, `@a2ui/markdown-it`, `markdown-it`, `zod`, `clsx`. `@a2ui/web_core`: `lit`, `@lit/context`, `@preact/signals-core`, `zod`, `zod-to-json-schema`, `redos-detector`, `validate-color`. Quay has none of these today except `clsx`. Zod is pinned to major 3.
11. **Installing 0.15.0 prints a peer conflict. W.** `@a2ui/markdown-it@0.2.2`, a dependency of `@a2ui/react@0.15.0`, declares a peer of `@a2ui/web_core@^0.14.0`. npm overrode it with a warning. pnpm, which Quay uses, was not tried.
12. **Bundle size, measured with esbuild, minified, React external. W.**

    | Bundle | Minified | Gzip |
    | :-- | --: | --: |
    | Surface + processor + 1.0 basic catalog | 484 kB | 136 kB |
    | The same with `@a2ui/markdown-it` | 659 kB | 199 kB |
    | Processor + 1.0 basic catalog, no React renderer | 464 kB | 129 kB |
    | `@a2ui/react` alone, core external | 11 kB | 4 kB |

    The core accounts for 295 kB of the first row, `redos-detector` 66 kB, `zod` 58 kB, `zod-to-json-schema` 20 kB and Lit about 20 kB. Tree-shaking was on, and the 0.8 code did not appear in the output.
13. **Importing `@a2ui/react@0.15.0` without a DOM throws. W, by running it.** `ReferenceError: HTMLElement is not defined`. The changelog records this as a regression since 0.13.0, fixed in 0.16.0. Quay's unit tests run under plain `node --test`, so any test file that imports the renderer needs a DOM first, or 0.16.0.

## 3. Styling

14. **The basic catalog is not React. It is Lit custom elements shared by the React, Lit and Angular renderers. W.** Since React 0.13.0, "`@a2ui/react/v0_9` no longer ships a React implementation of the basic catalog … they render as W3C Custom Elements." The rendered markup in the probe was `<a2ui-basic-column>`, `<a2ui-basic-text>`, `<a2ui-basic-button><button class="a2ui-button a2ui-button-default">`.
15. **Those elements bring their own look and take colours from CSS variables. W.** `injectBasicCatalogStyles()` adopts a stylesheet of `--a2ui-*` tokens (colours, border, radius, spacing scale, font scale) into `document.adoptedStyleSheets`. Each element adds component variables such as `--a2ui-button-padding` and `--a2ui-button-background`. The token rules use `:where()` so page CSS overrides them without a specificity fight. Classes `a2ui-dark` and `a2ui-light` lock the colour scheme.
16. **Tailwind classes cannot be put on the stock elements. W for the mechanism, T for the conclusion.** `A2uiSurface` takes one prop, `surface`. The elements render their own markup with fixed `a2ui-*` class names. They render into light DOM by default, so Quay's stylesheet could target `.a2ui-button`, but I found no statement that those class names are a stable interface. Matching GitHub-dark through the variables would get the colours and spacing close. It would not make a stock `Button` the same element as a Quay button.
17. **1.0 removed agent-supplied theming. W.** "A v1.0 `createSurface` that carries `theme` is invalid." Styling is the host's business, which suits Quay.
18. **`Text` needs a Markdown renderer from the host. W.** Without one the element logs "can't render markdown because no markdown renderer is configured" and shows plain text. The host supplies a function that returns HTML, such as `@a2ui/markdown-it` (which adds about 175 kB with `markdown-it` and `dompurify`), or a React component through `MarkdownComponentContext`. Quay has no Markdown renderer in the app today.
19. **Quay's CSP would block remote media in either route. W for the CSP, T for the effect.** `tauri.conf.json` sets `img-src 'self' blob:` and `default-src 'self'`. `Image`, `Video` and `AudioPlayer` load a URL the agent supplies. `openUrl` also needs a host decision. Constructable stylesheets are how the stock elements style themselves; I did not test them in the Tauri webview.

## 4. Swapping and adding components

20. **A custom component is a Zod schema plus a React function. W.** `createComponentImplementation(api, ({props, buildChild}) => …)` hands the component resolved props: bindings already read, an injected setter per bound property (`props.setValue`), actions as callable functions, and `props.isValid` and `props.validationErrors` from the checks. `createBinderlessComponentImplementation` gives the raw component context instead.
21. **A custom catalog is a list of components and functions under an id. W.** `new Catalog(id, '1.0', components, functions)` is passed to `new MessageProcessor([catalogs])`. Functions are made with `createFunctionImplementation`. A 1.0 surface can mix catalogs: `createSurface` names the default and a component names another with `@catalogId`. `allowedParents` and `allowedChildren` on a component are enforced by the processor.
22. **A host can replace a basic component with its own React component and keep the basic catalog's id. W, by running it; not shown in the documentation.** The core exports each basic component's schema (`ButtonApi`, `TextApi`, and so on) from `@a2ui/web_core/catalogs/basic/v1`. I wrote a `Button` and a `Text` with Tailwind class names against those schemas, built `basicCatalog.withEntries([...theOtherSixteen, QuayButton, QuayText], [...basicCatalog.functions.values()])`, and rendered a 1.0 surface that named the basic catalog. The output was Quay's markup inside the stock `Card` and `Column`; the action and a live data update both worked. The agent sees the standard catalog and needs no Quay-specific prompt.
23. **Each React component sits inside a host custom element. W.** The markup is `<a2ui-react-button style="display: contents;"><button class="…">`. The host element applies the `accessibility` attributes. The README says the Markdown component renders "as part of the app's React tree, so it reads the app's context"; I did not test whether a custom component reads Quay's React context. **T** for that. The basic catalog "no longer server-renders", which does not matter to a Tauri app.
24. **Quay-specific components fit the same mechanism. T.** A diff, a file link or a ticket chip would be a second catalog, or extra entries made with `Catalog.derive`, which builds a catalog under a new id from named entries of an existing one. I read the method's documentation and did not run it.
25. **The roadmap intends to make restyling easier, with no date. W.** "Primitives that you style to match your design system and describe declaratively" are "on the roadmap". The page warns that "priorities and scope may change".

## 5. Actions, function calls, validation

26. **Actions arrive at one callback. W.** The second argument of `MessageProcessor` is an action handler that receives the resolved action: `name`, `surfaceId`, `sourceComponentId`, `timestamp`, `context`. The host wraps it as `{version: '1.0', action}` and sends it over its own transport. The renderer has no transport of its own; the guide says messages can travel over "HTTP responses, Server-Sent Events (SSE), WebSockets, A2A, or MCP".
27. **Messages go in through `processMessages`, `processMessagesAsync` or `processMessagesWithErrors`. W.** The async form returns the `rendererFunctionResponse` messages produced by any `callRendererFunction` it processed. `getRendererCapabilities({versions: ['1.0']})` and `getRendererDataModel()` build the metadata the agent may want with each action.
28. **Function calls in both directions go through an outbound listener. W for the interface, T for behaviour, which I did not run.** `options.outboundListener` is the "listener receiving outbound renderer messages intended for the agent. Required for callAgentFunction." The guide says to pass it so the host can forward those envelopes. The agent's `agentFunctionResponse` comes back through the processor. `defaultTimeoutMs` defaults to 30000. The spec requires a response to every `callRendererFunction`, routes a call the renderer does not implement to the agent, and defines what a binding, a check and an action do when a call fails.
29. **Component properties are validated against the catalog by default. W, by running it.** A `Text` with `variant: 'h2'` threw `A2uiValidationError` with `path: '/components/2/variant'` and the message "Invalid enum value. Expected 'caption' | 'body', received 'h2'", with no validation option set.
30. **An unknown component type is rejected only when a validation config is set. W, by running it; T for the topology rules, which I read and did not run.** With no config, an unreferenced component of unknown type `Nope` produced no error. With `validationConfig: STRICT_VALIDATION` a root of that type produced `{"version":"1.0","error":{"code":"VALIDATION_FAILED","surfaceId":"s2","path":"/components/0/component","message":"Unknown component type 'Nope' not found in catalog …"}}`. The config covers root presence, dangling references, orphans, unknown elements, allowed message types, a target version and a depth limit of 50.
31. **Errors come out in the shape the agent is meant to read. W.** `processMessagesWithErrors` returns spec-shaped `error` envelopes instead of throwing. `reportErrorsOnly: true` with `errorHandler` does the same for the other entry points. This is the material for telling an agent what it got wrong.
32. **Render-time problems are reported separately. W from the changelog, not run.** Since 0.15.0 a component that has not arrived, has an unknown type, or repeats an ancestor renders nothing. Unknown types, cycles and unresolved child references go to the surface's `onError`. A fallback API is tracked upstream as issue 2013. A host that wants a loading state draws its own.

## 6. Licence, cadence, maintenance

33. **Apache-2.0. W.** Both manifests and the repository licence. Contributions need Google's contributor licence agreement.
34. **Releases are frequent. W.** `@a2ui/react` had 17 versions in the 230 days from 2026-03-17 to 2026-11-02, twelve of them not pre-releases. The last five releases came 8 to 16 days apart.
35. **The project is active. W.** In the 31 days to 2026-11-23 there were 33 commits touching the React renderer, 83 touching the core and 393 merged pull requests in the repository. The repository has at least 100 contributors, 18,259 stars and 309 open issues, 14 of them with "react" in the title. The last commit to the React renderer was on 2026-11-20.
36. **The announcement does not say React is waiting for 1.0. W for the quotes, as extracted by the fetch tool.** The sentence is "Open-source renderers draw A2UI screens with React, Angular, and Lit on the web; Flutter on mobile, web, and desktop; SwiftUI on iOS and Jetpack Compose on Android (currently v0.9.1, and v1.0 coming soon)." The parenthesis follows Jetpack Compose, and a later line says "The Jetpack Compose renderer supports 0.9.1 today, with 1.0 coming soon." Both numbers are protocol versions. The post gives no package version. The SDKs page lists React as supporting "v0.8, v0.9.1, v1.0".
37. **No community React renderer is listed for 1.0. W.** The community page lists React renderers on Radix with Tailwind, ShadCN and Material UI at 0.8 or 0.9. The 1.0 entries are Svelte, Compose Multiplatform and a WeChat renderer.

## 7. What a hand-written renderer would have to cover

Sources: the spec outline and the sections I read, the parsed `catalog.json`, and the SDKs page's list of what a renderer SDK does. **W** that each item is required or defined; **T** where I say how large it is.

### Components (18)

| Component | Properties | Behaviour to build |
| :-- | :-- | :-- |
| `Text` | `text`, `variant` (`caption`, `body`) | Simple Markdown. 1.0 has no `h1` to `h5` variants, so headings presumably come from Markdown (**T**) |
| `Image` | `url`, `description`, `fit` (5 values), `variant` (6 sizes from `icon` to `header`) | Alt text, sizing presets, CSP |
| `Icon` | `name` (59 names), `svgPath` | Map the 59 names to `lucide-react`; draw a raw path |
| `Video` | `url`, `posterUrl` | Player, CSP |
| `AudioPlayer` | `url`, `description` | Player, CSP |
| `Row`, `Column` | `children`, `justify` (7 values), `align` (4 values) | Flex layout; child list as array or template |
| `List` | `children`, `direction`, `align` | Scrolling; template repeated over a data array with a scope per item |
| `Card` | `child` | Container |
| `Tabs` | `tabs` (each a `title` and `child`) | Tab state, keyboard behaviour |
| `Modal` | `trigger`, `content` | Open and close, focus trap |
| `Divider` | `axis` | Rule |
| `Button` | `child`, `variant` (`default`, `primary`, `borderless`), `action` | Dispatch the action; disabled while a check fails |
| `TextField` | `label`, `value`, `placeholder`, `variant` (`shortText`, `longText`, `number`, `obscured`) | Two-way binding, checks, error text |
| `CheckBox` | `label`, `value` | Two-way binding, checks |
| `ChoicePicker` | `label`, `options`, `value`, `variant` (single or multiple), `displayStyle` (`checkbox`, `chips`), `filterable` | The largest input: 284 lines upstream |
| `Slider` | `label`, `value`, `min`, `max`, `steps` | Two-way binding |
| `DateTimeInput` | `label`, `value`, `enableDate`, `enableTime`, `min`, `max` | Three input modes; 263 lines upstream |

Every component also takes `weight` (flex share inside a `Row` or `Column`) and the envelope keys `id`, `@catalogId`, `@accessibility`, `@checks` and `@metadata`.

### Functions (14, plus `@index`)

`formatString` (interpolation of `${…}` with paths and nested calls, so it needs an expression parser), `formatNumber`, `formatCurrency`, `formatDate`, `pluralize`, `required`, `regex` (an "A2UI regex dialect" with safety limits; upstream ships a 66 kB detector for unsafe patterns), `length`, `numeric`, `email`, `openUrl` (requires user activation), `and`, `or`, `not` (over booleans and validation results), and `@index` inside list templates.

### Engine

1. **Messages.** Parse the 1.0 envelope and its six agent-to-renderer messages, including a `createSurface` that carries the whole tree and data; emit the four renderer-to-agent messages.
2. **Surfaces.** A registry of surfaces, creation and deletion, nothing drawn until `root` arrives, components buffered in any order.
3. **Tree.** Build a tree from the flat adjacency list; apply incremental `updateComponents` so that unchanged siblings keep focus and local state; survive missing children and cycles.
4. **Data model.** JSON Pointer reads and writes, `null` deleting a key, relative paths, a child scope per template item, the data-model snapshot for `sendDataModel` surfaces.
5. **Dynamic values.** Every bindable property is a literal, `{"@path"}` or `{"@call"}`; `@@` escapes a literal `@` key; an unknown single-`@` key is rejected; values re-evaluate when their data changes.
6. **Two-way binding.** Inputs write back to the data model locally without a round trip.
7. **Actions.** An event with a name and a context resolved at click time, or a function call; stop the pipeline on failure.
8. **Checks.** Evaluate `@checks` reactively, expose validity and messages, disable the dependent `Button`.
9. **Function calls.** Answer every `callRendererFunction`, enforce `allowedCallers`, route unimplemented calls to the agent as `callAgentFunction`, hold a pending state, time out, apply the three failure rules.
10. **Validation and errors.** Check each message and each component's properties against the catalog, check topology, and return `error` envelopes with a code and a path so the agent can correct itself.
11. **Capabilities.** Report supported catalog ids and protocol version; resolve `@catalogId` when more than one catalog is registered.
12. **Accessibility.** The spec says implementations "MUST" map `label`, `description`, `live` and `hidden` to the platform's accessibility API and let them override inferred defaults.
13. **Markdown** for `Text`, sanitised.

### How large

38. **Upstream's size, as a yardstick. W.** The 18 Lit elements and their shared styles are 3,211 lines. The retired React implementation of the 0.8 catalog in the same package is 4,320 lines. The core, without tests and without 0.8, is about 40,900 lines; it serves four protocol versions, three frameworks and catalog tooling, so most of it is not needed for one version and one catalog.
39. **My estimate for Quay. T.** The 18 components in Quay's own classes: roughly 1,500 to 2,500 lines of TSX, the same in either route below. A 1.0-only engine for items 1 to 13: several thousand more lines plus tests, and it would have to follow each spec change by hand.
40. **Upstream offers a way to check a hand-written engine. W that it exists; not read.** The SDKs page points custom implementers at `blueprints/modules` and the YAML suites in `conformance/core` (29 files, including `message_processor_v1_0.yaml`, `validator_v1_0.yaml`, `data_model.yaml`, `expressions.yaml` and `rpc_functions.yaml`).

## 8. The routes side by side

| | A. Official renderer, stock catalog | B. Official engine, Quay's components | C. Hand-written |
| :-- | :-- | :-- | :-- |
| What Quay writes | Theme variables, a Markdown renderer, transport | 18 React components against upstream's schemas, a Markdown renderer, transport | The 18 components, the 14 functions and the whole engine in section 7 |
| Look | Upstream's elements tinted by `--a2ui-*` variables | Quay's own classes and markup | Quay's own |
| Added to the bundle | About 484 kB minified | About 484 kB while stock elements remain; less once all 18 are replaced, which I did not measure (**T**) | Only Quay's code |
| New dependencies | `@a2ui/react`, `@a2ui/web_core`, `zod` 3, Lit, signals and the rest of finding 10 | The same | None |
| Keeping up with A2UI | Upgrade the packages; expect breaking minors | The same, plus Quay's components follow schema changes | Quay follows the spec by hand |
| Proven here | Finding 2 | Finding 22, for two components | Not attempted |

Route B can start from route A and replace components one at a time, since a catalog may mix stock and host components (finding 22).

## 9. Not established

- When 0.16.0 reaches npm, and whether it installs cleanly under pnpm.
- Whether the stock elements' constructable stylesheets and Quay's `style-src` policy get on in the Tauri webview.
- How the core behaves when an agent mixes 0.9 and 1.0 messages on one surface. A 1.0 surface accepted a 0.9-style `{"path": …}` binding without error in the probe; I did not check what it rendered.
- Function calls in either direction on the React renderer: read, not run.
- The cost of the host element around each React component (`display: contents`) on Quay's layout and on tools that read the accessibility tree.
