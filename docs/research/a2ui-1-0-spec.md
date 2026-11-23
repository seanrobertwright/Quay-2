# A2UI 1.0: what it specifies and whether it is stable

Research note for issue #683 (map: #682). Researched 2026-11-23.

**Gist.** A2UI 1.0 is stable: the specification repository marked it so on 2026-11-06 and Google announced it on 2026-11-11. It is a transport-agnostic JSON protocol with six agent-to-renderer messages and four renderer-to-agent messages. Its only normative transport binding is A2A. MCP is covered by guides and one web package, and every published MCP pattern has the MCP server producing A2UI and the MCP client rendering it, which is the reverse of Quay's layout.

Each finding is marked **W** (well supported: read in the primary source) or **T** (tentative: source not read in full, sources conflict, or an inference of mine).

## Sources

All repository paths are in `a2ui-project/a2ui` at commit `5ff1b05` (2026-11-20). `github.com/google/A2UI` now redirects to that repository.

| Short name | Source | Read |
| :-- | :-- | :-- |
| Spec | [`specification/v1_0/docs/a2ui_protocol.md`](https://github.com/a2ui-project/a2ui/blob/5ff1b05/specification/v1_0/docs/a2ui_protocol.md), published at <https://a2ui.org/specification/v1.0-a2ui/> | In full |
| Evolution guide | [`specification/v1_0/docs/evolution_guide.md`](https://github.com/a2ui-project/a2ui/blob/5ff1b05/specification/v1_0/docs/evolution_guide.md) | In full |
| Schemas | [`specification/v1_0/json/`](https://github.com/a2ui-project/a2ui/tree/5ff1b05/specification/v1_0/json): `agent_to_renderer.json`, `renderer_to_agent.json`, both capability schemas, the list and list-wrapper schemas | In full |
| A2A extension | [`specification/v1_0/extensions/a2a/docs/a2ui_extension_specification.md`](https://github.com/a2ui-project/a2ui/blob/5ff1b05/specification/v1_0/extensions/a2a/docs/a2ui_extension_specification.md) | In full |
| MCP overview | [`docs/site/src/content/docs/guides/mcp-overview.mdx`](https://github.com/a2ui-project/a2ui/blob/5ff1b05/docs/site/src/content/docs/guides/mcp-overview.mdx) | In full |
| A2UI over MCP | [`guides/a2ui-over-mcp.mdx`](https://github.com/a2ui-project/a2ui/blob/5ff1b05/docs/site/src/content/docs/guides/a2ui-over-mcp.mdx) | In full |
| MCP catalog guide | [`guides/mcp-catalog.mdx`](https://github.com/a2ui-project/a2ui/blob/5ff1b05/docs/site/src/content/docs/guides/mcp-catalog.mdx) | In full |
| catalog-mcp README | [`typescript/catalogs/mcp/README.md`](https://github.com/a2ui-project/a2ui/blob/5ff1b05/typescript/catalogs/mcp/README.md) and its `CHANGELOG.md` | Sections on the catalog, data functions and tool-call steps; changelog in full |
| A2UI in MCP Apps | [`guides/a2ui-in-mcp-apps.mdx`](https://github.com/a2ui-project/a2ui/blob/5ff1b05/docs/site/src/content/docs/guides/a2ui-in-mcp-apps.mdx) | Architecture section only |
| Version status | [`specification/versions.json`](https://github.com/a2ui-project/a2ui/blob/5ff1b05/specification/versions.json), [`specification/v1_0/README.md`](https://github.com/a2ui-project/a2ui/blob/5ff1b05/specification/v1_0/README.md), commit [`dee8167`](https://github.com/a2ui-project/a2ui/commit/dee8167) | In full |
| Announcement | <https://developers.googleblog.com/a2ui-10-build-delightful-fast-reliable-agentic-experiences/> (2026-11-11) | Through a fetch tool that extracts quotes, not the raw page |
| npm registry | `registry.npmjs.org` for `@a2ui/web_core`, `@a2ui/react`, `@a2ui/catalog-mcp`, `@a2ui/agent` | Queried 2026-11-23 |

Not read: the AG-UI and CopilotKit documentation, the guide on embedding MCP Apps in A2UI surfaces, the custom functions guide, the basic catalog implementation guide, and Google's June post on A2UI and MCP Apps.

## 1. Release status

1. **1.0 is stable. W.** The v1.0 README says "This specification is stable. Breaking changes go into a future major version." `versions.json`, which the repository calls the single source of truth, lists v1.0 as `current`, v0.9.1 and v0.9 as `previous`, and v0.8 as `deprecated`. The spec's own header reads "Status: Current". The live page at a2ui.org says "A2UI v1.0 is the current specification."
2. **The "candidate, use 0.9.1" wording was true until 2026-11-06 and is now gone. W.** Commit `dee8167` ("docs: mark v1.0 as the current protocol version") changed the README from "currently a candidate for becoming stable", the spec header from "Status: Candidate", and `versions.json` from v0.9.1 `current` and v1.0 `release candidate`. Anything seen saying otherwise was read before that date or from a cache.
3. **One stale statement remains in the repository. W.** [`context7.json`](https://github.com/a2ui-project/a2ui/blob/5ff1b05/context7.json) still tells documentation indexers "Current protocol is v0.9.1 (v1.0 is a release candidate, v0.8 is legacy)". Tools that draw on that index may repeat it.
4. **The announcement calls 1.0 "the first stable version" and admits the ecosystem trails. W for the quotes, as extracted by the fetch tool.** It says the renderers are "currently v0.9.1, and v1.0 coming soon", that Jetpack Compose and Gemini support 0.9.1, and that Gemini Enterprise is being upgraded.
5. **A breaking wire change landed in the 1.0 schemas after the stable marking. W.** Commit [`24d1bf9`](https://github.com/a2ui-project/a2ui/commit/24d1bf9) on 2026-11-11 (`feat!`) renamed the component envelope keys to `@catalogId`, `@metadata`, `@accessibility` and `@checks`. Renderers and core SDKs still accept the bare names during a transition (Evolution guide, section 2.9). Treat 1.0 as stable in intent with the last edges still settling.
6. **The published packages are behind the specification. W.** On npm, `@a2ui/web_core` and `@a2ui/react` are at 0.15.0 (2026-11-02) while the repository is at 0.16.0. `@a2ui/catalog-mcp` is at 0.0.3 on npm and 0.1.0 in the repository. All SDK version numbers are below 1.0 although the protocol is 1.0. The SDK table in [`concepts/sdks.mdx`](https://github.com/a2ui-project/a2ui/blob/5ff1b05/docs/site/src/content/docs/concepts/sdks.mdx) lists React, Lit, Angular, Flutter and SwiftUI as supporting v1.0 and Kotlin/Jetpack Compose as v0.9.1 only.

## 2. Messages and their order

7. **Every message is one JSON object holding `"version": "1.0"` and exactly one message key. W** (Spec, "Envelope message structure"; Schemas).
8. **Agent to renderer, six keys. W.**
   - `createSurface`: `surfaceId` (required), optional `catalogId`, `sendDataModel`, `components`, `dataModel`, `metadata.extensions`.
   - `updateComponents`: `surfaceId`, `components` (a flat list, at least one item).
   - `updateDataModel`: `surfaceId`, optional `path` (JSON Pointer, default `/`), required `value`. A `null` value deletes the key.
   - `deleteSurface`: `surfaceId`.
   - `callRendererFunction`: `functionCallId`, `callFunction` (`@call`, required `catalogId`, optional `args`), optional `surfaceId`.
   - `agentFunctionResponse`: `functionCallId` plus `value` or `error`.
9. **Renderer to agent, four keys. W.** `action`, `callAgentFunction`, `rendererFunctionResponse`, `error` (Spec, "Renderer-to-agent event messages"; `renderer_to_agent.json`).
10. **Ordering rules. W.**
    - A surface must be created before it is updated, unless the agent knows of an existing surface it may modify.
    - Envelopes in a stream or batch are dispatched in arrival order.
    - Components may arrive in any order. Nothing is drawn until a component with id `root` exists; earlier components are buffered. Missing children and unresolved data paths render as placeholders.
    - A single `createSurface` that carries both `dataModel` and `components` applies the data model first.
    - Surface changes that precede a function-call envelope take effect before that envelope is dispatched.
    - The end of an agent turn is not an A2UI message. The transport signals it.
11. **A whole surface can be sent in one message. W.** New in 1.0: `createSurface` may carry the full component tree and initial data.
12. **Batches have two schema forms. W.** `agent_to_renderer_list.json` is a bare array of messages. `agent_to_renderer_list_wrapper.json` is `{"messages": [...]}`, "intended for protocols that require a top-level JSON object". The same pair exists for renderer-to-agent messages.

## 3. Surfaces

13. **A surface is one rendered UI with its own component tree and data model, identified by `surfaceId`. W.** The id "must be globally unique for the renderer's lifetime". Creating a surface whose id already exists, without deleting it first, is an `INTEGRITY_ERROR`. The spec tells orchestrators with several agents to prefix ids or require UUIDs.
14. **`surfaceId` and the default `catalogId` are fixed for the life of the surface. W.** Changing them means delete and recreate.
15. **`createSurface` implicitly creates a reserved `Surface` container whose child is `root`. W.** It cannot be changed by `updateComponents`, and no catalog may define a component named `Surface`.

## 4. Component model

16. **Components are a flat adjacency list. W.** Each has `id`, `component` (the type name) and the type's own properties. Containers refer to children by id (`child`, `children`). There must be exactly one `root`.
17. **`updateComponents` replaces a component definition in full. W.** A property left out on update is dropped, including `@metadata`.
18. **Four optional envelope keys use the `@` prefix. W.** `@catalogId`, `@accessibility`, `@metadata`, `@checks`. `id` and `component` stay bare.
19. **Lists are built from a template. W.** `children: {"componentId": "...", "path": "/items"}` instantiates the template once per array item. Inside it, paths without a leading `/` are relative to the item, and `{"@call": "@index"}` gives the position.
20. **Identifiers follow Unicode UAX #31. W.** Component ids, component names, function names and property names must match `^[\p{XID_Start}_][\p{XID_Continue}]*$`. `user_card` is valid; `user-card` is not.

## 5. Catalogs

21. **A catalog is a JSON Schema document that defines the components and functions an agent may use. W.** Root keys are limited to `$schema`, `$id`, `protocolVersion`, `title`, `description`, `catalogId`, `instructions`, `metadata`, `components`, `functions`, `$defs`. `protocolVersion: "1.0"` is required for 1.0 catalogs. `instructions` holds Markdown guidance for the model.
22. **`catalogId` is an arbitrary string, by convention a URI, and need not resolve. W.** Agent and renderer must agree on it in advance.
23. **The basic catalog has 18 components and 14 functions plus the system function `@index`. W** ([`catalogs/basic/v1/catalog.json`](https://github.com/a2ui-project/a2ui/blob/5ff1b05/catalogs/basic/v1/catalog.json), id `https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json`).
    - Components: Text, Image, Icon, Video, AudioPlayer, Row, Column, List, Card, Tabs, Modal, Divider, Button, TextField, CheckBox, ChoicePicker, Slider, DateTimeInput.
    - Functions: required, regex, length, numeric, email, formatString, formatNumber, formatCurrency, formatDate, pluralize, openUrl, and, or, not.
    - `Text` supports simple Markdown. Headings are Markdown markers, not variants.
24. **Custom catalogs are the expected route for real applications. W.** The spec says "most production applications will define their own catalog to reflect their specific design system", and that a custom catalog restricts the agent to exactly the components the application has.
25. **Catalogs can be mixed on one surface. W.** A component names its catalog with `@catalogId`, a function call with `catalogId`; otherwise the surface default applies. If neither is present the component is not rendered. There is no fallback to the capability list.
26. **Catalogs can constrain nesting. W.** `allowedParents` and `allowedChildren` on a component definition; violations produce `UNALLOWED_PARENT` or `UNALLOWED_CHILD`.
27. **1.0 has no theme. W.** `theme` and `primaryColor` were removed; styling is left to the host's own theme. A 1.0 `createSurface` carrying `theme` is invalid.
28. **A renderer can send catalog definitions inline. W.** `inlineCatalogs` in renderer capabilities, allowed only when the agent declares `acceptsInlineCatalogs: true`.

## 6. Data model

29. **Each surface has one JSON data model, addressed by JSON Pointer (RFC 6901). W.**
30. **Any bindable property takes a literal, `{"@path": "..."}` or `{"@call": "...", "args": {...}}`. W.**
31. **Input components bind two ways, locally. W.** TextField, CheckBox, Slider, ChoicePicker and DateTimeInput write to the local data model on every interaction, creating the path if needed. Typing sends nothing to the agent.
32. **The agent sees input only when an action fires. W.** Either the action's `context` references the paths, or the surface was created with `sendDataModel: true`, in which case the renderer attaches the whole data model to the metadata of every message it sends to the agent that created the surface.
33. **`updateDataModel` is an upsert. W.** It replaces the value at `path`, creates it if absent, removes it when `value` is `null`, and replaces the whole model when `path` is omitted or `/`.

## 7. Actions and function calls

34. **A component action is either an event for the agent or a local function call. W.**
    - `action.event`: `name`, optional `userMessage`, optional `context` (values may be bindings).
    - `action.functionCall`: a function the renderer runs, such as `openUrl`.
35. **The `action` message the renderer sends has five required fields. W.** `name`, `surfaceId`, `sourceComponentId`, `timestamp` (ISO 8601) and `context` (bindings already resolved). Optional: `userMessage`, `metadata.extensions`.
36. **Function calls run in both directions, matched by `functionCallId`. Both are new in 1.0. W.**
    - Agent to renderer: `callRendererFunction`, answered by `rendererFunctionResponse`. The renderer must always answer, with `value` or `error`.
    - Renderer to agent: `callAgentFunction`, answered by `agentFunctionResponse`.
37. **The catalog decides who may call a function. W.** `allowedCallers` is `rendererOnly` (the default), `agentOnly` or `rendererOrAgent`. Functions with `requiresUserActivation: true` run only from a user gesture and must be `rendererOnly`. A refused call returns `INVALID_FUNCTION_CALL`.
38. **Calls the renderer cannot run are routed to the agent. W.** If a function is undeclared, or declared without a local implementation, the renderer sends `callAgentFunction`. This applies inside bindings, checks and actions, so a surface can depend on the agent answering while it is displayed.
39. **A renderer may only be called after the renderer has opened the session. W.** "Renderer functions can only be called after a session has been initiated by the renderer."
40. **The spec shows function calls over request-response transports. W.** Over HTTP the agent returns `callRendererFunction` in a response and the renderer delivers the result in a follow-up request (Spec, "Transport Interaction Patterns").
41. **Validation runs in the renderer through `@checks`. W.** Each check has a `condition` and an optional `message`. A button with a failing check is disabled.

## 8. Capabilities, accessibility, extensions, errors

42. **Capabilities are not A2UI messages. W.** They travel in transport metadata or a transport handshake, and each binding says where.
    - Renderer: `a2uiRendererCapabilities` = `{"1.0": {"supportedCatalogIds": [...], "inlineCatalogs": [...]}}`.
    - Agent: `{"1.0": {"supportedCatalogIds": [...], "acceptsInlineCatalogs": false}}`.
43. **Capability exchange is optional when one party owns both ends. W.** "Systems where the agent and client are owned by the same party may not need capability negotiation" ([`concepts/messages.mdx`](https://github.com/a2ui-project/a2ui/blob/5ff1b05/docs/site/src/content/docs/concepts/messages.mdx)).
44. **Accessibility is `@accessibility` on any component. W.** Fields: `label`, `description`, `live` (`off`, `polite`, `assertive`), `hidden`. Renderers must map them to the platform's accessibility API and must infer defaults from visible text; explicit values override inferred ones.
45. **Extensions are a `metadata.extensions` map in five places. W.** Catalog, catalog component definition, surface (`createSurface.metadata`), component instance (`@metadata`) and outgoing action (`action.metadata`). Keys follow UAX #31. `a2ui_` is reserved; third parties prefix with their own identifier. Renderers must ignore keys they do not recognise.
46. **Errors have a standard shape meant for model self-correction. W.**
    - Validation: `{"error": {"code": "VALIDATION_FAILED", "surfaceId", "path", "message"}}`, where `path` is a JSON Pointer to the failing field.
    - Other codes seen: `INTEGRITY_ERROR`, `INVALID_FUNCTION_CALL`, `EXPRESSION_ERROR`, `EXECUTION_ERROR`, `UNKNOWN_FUNCTION`, `UNALLOWED_PARENT`, `UNALLOWED_CHILD`.
    - The spec describes a prompt, generate, validate loop in which errors go back to the model.

## 9. What a transport must provide

47. **Four requirements. W** (Spec, "The transport contract").
    1. Reliable, ordered delivery.
    2. Framing that delimits each JSON envelope.
    3. A way to attach metadata to messages, used for the data model and for capabilities.
    4. A return channel for `action` messages. The spec calls this optional, and necessary for interactive use.
48. **The transport also signals the end of a turn. W.**
49. **The MIME type is `application/a2ui+json`. W.** It was `application/json+a2ui` in 0.9.

## 10. Published bindings

### A2A

50. **A2A is the only binding with a normative specification. W.** It is the sole entry under `specification/v1_0/extensions/`.
51. **What it defines. W.**
    - Extension URI `https://a2ui.org/a2a-extension/a2ui/v1.0`, advertised in the Agent Card with the agent capabilities as `params`.
    - Messages travel as an A2A `DataPart` with `metadata.mimeType = "application/a2ui+json"`, whose `data` is always an array of messages, in both directions.
    - Renderer capabilities and the data model ride on `message.metadata`. Capabilities are scoped to the turn: a message without them offers no A2UI.
    - A batch is not transactional. Process in order, continue past a failing message, and avoid repainting until the batch is done.

### MCP

52. **There is no normative MCP binding. W.** The spec gives MCP one sentence: A2UI "can be carried over MCP tool calls, tool outputs, or resource subscriptions". Everything else is guides, samples and one package.
53. **The guides describe four patterns, and in all four the MCP server supplies the UI and the MCP client side renders it. W** (MCP overview).
    1. A2UI buttons call ordinary MCP tools (`@a2ui/catalog-mcp`).
    2. An MCP server serves A2UI layouts and data.
    3. An A2UI surface embeds an MCP App (`ui://` HTML) in a sandbox.
    4. An MCP App bundles an A2UI renderer, so a host such as Claude Desktop, Cursor or VS Code can show A2UI.
54. **Pattern 2, A2UI carried in resources and tool results. W** (A2UI over MCP).
    - Layout: an MCP resource at an `a2ui://` URI with MIME type `application/a2ui+json`, whose text is a JSON array holding `createSurface` and `updateComponents`.
    - Link: `_meta.ui = {resourceUri, mimeType}` on the tool descriptor, on the `CallToolResult`, or both. The result's value overrides the descriptor's.
    - Data: `tools/call` returns an `EmbeddedResource` with MIME type `application/a2ui+json` containing `updateDataModel`, next to a plain `TextContent` summary for hosts that cannot render.
    - The client caches the layout by URI and reads it only on a miss.
    - Only an embedded resource declaring the MIME type counts as A2UI. A text block is treated as prose for the model even if it contains a message (catalog-mcp README, "What a tool call does").
    - MCP `annotations.audience` controls who sees the payload: `["user"]` renders it and keeps it out of the model's context.
55. **MCP as the only transport. W** (A2UI over MCP, "Full bidirectional A2UI transport over MCP").
    - Capabilities: `params.capabilities.a2ui.rendererCapabilities` in the MCP `initialize` request for stateful sessions, or `params._meta.a2ui.rendererCapabilities` on each `tools/call` for stateless servers.
    - Actions: the client forwards each `action` to a server tool named `a2ui_action`, with the five required fields as flat tool arguments and no version envelope. The server must declare all five in the tool schema.
    - Errors: forwarded the same way to a tool named `a2ui_error` with `code`, `surfaceId`, `path`, `message`.
    - These tool names are a convention from the guide, not part of the spec.
56. **`@a2ui/catalog-mcp`. W** (MCP catalog guide; catalog-mcp README).
    - A web-only TypeScript package for renderers built on `MessageProcessor` (Lit, React, Angular). Requires A2UI 1.0 or later for the catalog as shipped.
    - Catalog id `https://a2ui.org/specification/v1_0/catalogs/mcp/catalog.json`. One component, `McpApp`. Five functions: `callMcpTool`, `transformData` (JMESPath), `updateDataModel`, `split`, `regexCapture`.
    - `callMcpTool` takes `name`, `arguments` and optional `targetDataPath`. It calls the tool from the renderer without an agent turn, writes the result into the data model, and applies any A2UI found in the result or in the UI resources the result points to.
    - The host supplies `getMcpClientForTool(toolName)`. Payloads name tools, never servers.
    - It moved from 0.0.1-alpha to 0.1.0 with several breaking changes in a short period.
57. **Pattern 4 returns actions as tool calls. T (architecture section only).** The embedded app turns A2UI actions into `tools/call` requests relayed through the host. Tools can be scoped with `_meta.ui.visibility` to `["model"]` or `["app"]`, which keeps UI callback tools out of the model's tool list.

### AG-UI

58. **The spec names AG-UI "the standard transport binding" but the repository defines nothing for it. T.** The spec links to `docs.ag-ui.com`. The agent integration guide shows only a CopilotKit runtime option (`a2ui: {injectA2UITool: true}`) and defers to CopilotKit's documentation, which I did not read. What AG-UI events carry A2UI is therefore unverified.

## 11. Changes from 0.9.1

59. **A 0.9.1 message is not a valid 1.0 message. W.** The 1.0 schemas require `"version": "1.0"`; the 0.9.1 schema allows only `"v0.9"` or `"v0.9.1"`. Beyond the version string, bindings, checks and several component properties differ.
60. **A renderer can still accept both, by routing on `version`. W.** The Evolution guide tells renderers to inspect `version` and hand each payload to a version-specific controller. `@a2ui/web_core` ships `v0_9` and `v1_0` entry points and the React renderer README says it renders v0.9, v0.9.1 and v1.0 from one package. Catalogs mixed on one surface must share a protocol version.
61. **Main differences an agent author meets. W** (Evolution guide).

    | Area | 0.9.1 | 1.0 |
    | :-- | :-- | :-- |
    | Version string | `"v0.9"` or `"v0.9.1"` | `"1.0"` |
    | Data binding | `{"path": "/x"}` | `{"@path": "/x"}` |
    | Function call | `{"call": "f"}` | `{"@call": "f"}` |
    | Component envelope keys | `accessibility`, `checks` | `@accessibility`, `@checks`, plus new `@catalogId`, `@metadata` |
    | Component ids | Hyphens allowed | UAX #31, no hyphens |
    | `createSurface` | `catalogId` required, `theme` allowed | `catalogId` optional, `theme` invalid, may carry `components` and `dataModel` |
    | `updateDataModel.value` | Optional | Required; `null` deletes |
    | Text headings | `variant: "h1"` to `"h5"` | Markdown in `text`; variants are `body` and `caption` |
    | TextField | `validationRegexp`; `value` optional | `@checks` with `regex`; `value` required |
    | Function-call messages | None. Functions exist only inside components, run by the renderer | `callRendererFunction` and `callAgentFunction` with typed responses |
    | Catalogs per surface | One | Several |
    | Schema names | `server_to_client`, `client_to_server` | `agent_to_renderer`, `renderer_to_agent` |
    | Metadata keys | `a2uiClientCapabilities`, `a2uiClientDataModel` | `a2uiRendererCapabilities`, `a2uiRendererDataModel` |
    | MIME type | `application/json+a2ui` | `application/a2ui+json` |

62. **0.9 catalogs do not work with 1.0 runtimes unchanged. W.** The Evolution guide says so and lists the structural reasons.
63. **Migration cannot be a find-and-replace. W.** `path` stays bare in list templates and in the `updateDataModel` envelope, and literal keys that begin with `@` must be doubled (`@@type`).

## 12. What this means for Quay

These are inferences from the findings above and are all **T**.

64. **Quay's layout is the mirror image of every published MCP pattern.** In Quay the agent CLI is the MCP client and Quay, the renderer, is the MCP server. The guides assume the opposite. `@a2ui/catalog-mcp`, `a2ui://` resources, `_meta.ui.resourceUri` and the `a2ui_action` tool all point the wrong way for Quay and cannot be adopted as they stand. Quay would be defining its own carrier, which the spec permits as long as the transport contract in finding 47 holds.
65. **The natural carrier is A2UI messages as tool-call arguments.** The spec's phrase "carried over MCP tool calls" allows it, and the list-wrapper schema `{"messages": [...]}` fits MCP's rule that tool arguments are an object. One tool call is one ordered batch, which satisfies ordering and framing.
66. **The return path has to fit request-response.** Quay's server has no stream, so an `action` can reach the agent only as the result of a tool call the agent makes: either the call that presented the surface stays open until the operator acts, or a later call collects the action. The spec's HTTP pattern (finding 40) is the precedent, with the roles swapped.
67. **Live boards are repeated `updateDataModel` calls.** Each is a small tool call against an existing surface; the layout is sent once.
68. **Validation errors should come back in the tool result, in the spec's error shape.** That gives the agent the JSON Pointer it needs to correct itself (finding 46).
69. **Function calls can be left out at first.** A renderer may answer every `callRendererFunction` with `INVALID_FUNCTION_CALL`. `callAgentFunction` needs the agent reachable while the surface is on screen, which a tool-call-only carrier does not give, so Quay's catalog should declare no agent-side functions.
70. **Surface ids need a per-terminal prefix.** Ids are unique for the renderer's lifetime and Quay hosts many agents (finding 13).
71. **Quay can skip capability negotiation and publish its catalog instead.** Quay owns the renderer and tells the agent what it supports (finding 43). No published binding says how an MCP server advertises renderer capabilities, so the tool description or the MCP `initialize` result would be Quay's own choice.
72. **A custom catalog and Quay's own components are in keeping with the spec.** 1.0 has no theme and expects production hosts to define their catalog (findings 24 and 27). Quay need not use Google's React renderer.
73. **Target 1.0 only, and emit the `@`-prefixed keys.** Models may have learned 0.9 syntax, so the catalog instructions and error messages need to state the 1.0 forms. Accepting 0.9.1 would mean a second code path keyed on `version` (finding 60).

## Corrections to what was assumed going in

- "The spec page and README call 1.0 a candidate and recommend 0.9.1": no longer true since 2026-11-06 (findings 1 and 2). Only `context7.json` still says it.
- "Bindings exist for MCP, A2A and AG-UI": only A2A has a specification. MCP has guides and a web package; AG-UI is delegated to AG-UI and CopilotKit (findings 50, 52, 58).
- "1.0 added accessibility": 0.9.1 already had `accessibility` with `label` and `description`. 1.0 renamed it `@accessibility`, added `live` and `hidden`, and made renderer support normative (finding 44; Evolution guide).
- "1.0 added bidirectional function calls": confirmed, and it is larger than it sounds. The 0.9.1 schemas have no function-call message in either direction (four agent-to-renderer keys, and only `action` and `error` coming back), so both directions are new. The Evolution guide's phrase "replaced `callFunction`" refers to an earlier 1.0 draft, not to 0.9.1.
- The repository has moved from `google/A2UI` to `a2ui-project/a2ui`.
