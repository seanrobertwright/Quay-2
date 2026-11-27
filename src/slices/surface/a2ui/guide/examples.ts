// The guide's calls of quay_surface: the one to copy, and the worked examples, each made after the ones before it.
import type { JsonObject } from "../../json.ts";
import type { SurfacePlace } from "../../surfaceTypes.ts";

/** A call's arguments. */
export interface Call {
  place?: SurfacePlace;
  title?: string;
  messages: JsonObject[];
}

interface Example {
  /** What it shows. */
  heading: string;
  call: Call;
}

const at = (path: string) => ({ "@path": path });

const text = (id: string, said: unknown, more: JsonObject = {}): JsonObject => ({ id, component: "Text", text: said, ...more });

/** A check that the text at `path` is there. */
const needed = (path: string, message: string) => ({ "@checks": [{ condition: { "@call": "required", args: { value: at(path) } }, message }] });

const message = (key: string, body: JsonObject): JsonObject => ({ version: "1.0", [key]: body });

/** The call the guide gives first, for a model to copy and change: the least that waits for an answer. */
export const COPY: Call = {
  place: "companion",
  title: "Run the migration",
  messages: [
    message("createSurface", {
      surfaceId: "confirm",
      components: [
        { id: "root", component: "Column", children: ["ask", "run"] },
        text("ask", "Run the migration on the **staging** database now?"),
        { id: "run", component: "Button", variant: "primary", child: "run_label", action: { event: { name: "run", context: {} } } },
        text("run_label", "Run it"),
      ],
    }),
  ],
};

const ASK: Example = {
  heading: "A form that waits for the operator. The Button has the check too, or it would send an empty branch.",
  call: {
    place: "companion",
    title: "Release branch",
    messages: [
      message("createSurface", {
        surfaceId: "release",
        dataModel: { branch: "", size: [], day: "", notify: false },
        components: [
          { id: "root", component: "Column", children: ["intro", "branch", "size", "day", "notify", "buttons"] },
          text("intro", "`master` is **3 commits** ahead. What should I cut?"),
          { id: "branch", component: "TextField", label: "Branch", placeholder: "release/1.4", value: at("/branch"), ...needed("/branch", "A branch is needed.") },
          {
            id: "size",
            component: "ChoicePicker",
            label: "Size",
            value: at("/size"),
            options: [
              { label: "Small", value: "small", description: "Fixes only", recommended: true },
              { label: "Large", value: "large" },
            ],
          },
          { id: "day", component: "DateTimeInput", label: "Not before", enableDate: true, value: at("/day") },
          { id: "notify", component: "CheckBox", label: "Tell the other agents", value: at("/notify") },
          { id: "buttons", component: "Row", children: ["cut", "skip"] },
          {
            id: "cut",
            component: "Button",
            variant: "primary",
            child: "cut_label",
            action: { event: { name: "cut", context: { branch: at("/branch"), size: at("/size"), day: at("/day"), notify: at("/notify") } } },
            ...needed("/branch", "A branch is needed."),
          },
          text("cut_label", "Cut it"),
          { id: "skip", component: "Button", child: "skip_label", action: { event: { name: "skip", context: {} } } },
          text("skip_label", "Not now"),
        ],
      }),
    ],
  },
};

const REPORT: Example = {
  heading: "A report in a tab: a list drawn from data, and a Button that opens a page.",
  call: {
    place: "tab",
    title: "Call sites of parseDate",
    messages: [
      message("createSurface", {
        surfaceId: "report",
        dataModel: {
          sites: [
            { file: "src/lib/dates.ts", line: 42, uses: 3 },
            { file: "src/App.tsx", line: 7, uses: 1 },
          ],
        },
        components: [
          { id: "root", component: "Column", children: ["head", "sites", "docs"] },
          text("head", "## Four calls in two files\n\nEach reads a date with **no zone**."),
          { id: "sites", component: "List", children: { componentId: "site", path: "/sites" } },
          { id: "site", component: "Card", child: "site_row" },
          { id: "site_row", component: "Row", align: "center", children: ["number", "file", "uses"] },
          text("number", { "@call": "@index", args: { offset: 1 } }),
          { id: "file", component: "FileLink", path: at("file"), line: at("line") },
          text("uses", { "@call": "formatString", args: { value: "${uses} ${pluralize(value:${uses}, one:'use', other:'uses')}" } }, { variant: "caption" }),
          { id: "docs", component: "Button", variant: "borderless", child: "docs_label", action: { functionCall: { "@call": "openUrl", args: { url: "https://tc39.es/proposal-temporal/docs/" } } } },
          text("docs_label", "Read about Temporal"),
        ],
      }),
    ],
  },
};

const STRIP: Example = {
  heading: "Status in a strip, drawn from data.",
  call: {
    place: "strip",
    title: "Nightly import",
    messages: [
      message("createSurface", {
        surfaceId: "import",
        dataModel: {
          done: 120,
          steps: [
            { label: "Download", state: "done" },
            { label: "Import", state: "active", note: "table 3" },
          ],
        },
        components: [
          { id: "root", component: "Column", children: ["bar", "steps"] },
          { id: "bar", component: "Progress", label: "Rows", done: at("/done"), total: 400 },
          { id: "steps", component: "Steps", steps: at("/steps") },
        ],
      }),
    ],
  },
};

const UPDATE: Example = {
  heading: "Later, one value changes and a Stat is added. `root` is sent whole, with the new child in its list.",
  call: {
    messages: [
      message("updateDataModel", { surfaceId: "import", path: "/done", value: 260 }),
      message("updateComponents", {
        surfaceId: "import",
        components: [
          { id: "root", component: "Column", children: ["bar", "steps", "failed"] },
          { id: "failed", component: "Stat", label: "failed", value: "2" },
        ],
      }),
    ],
  },
};

const REPLACE: Example = {
  heading: "To take components away, delete the surface and create it again in one call. This one also takes the report back.",
  call: {
    place: "strip",
    title: "Nightly import, done",
    messages: [
      message("deleteSurface", { surfaceId: "report" }),
      message("deleteSurface", { surfaceId: "import" }),
      message("createSurface", { surfaceId: "import", components: [text("root", "Imported **398** of 400 rows.")] }),
    ],
  },
};

export const EXAMPLES: readonly Example[] = [ASK, REPORT, STRIP, UPDATE, REPLACE];

/** A message, with each of its components on a line of its own. */
function messageJson(written: JsonObject): string {
  const components = Object.values(written).flatMap((body) => (body as { components?: JsonObject[] }).components ?? []);
  return components.map((component) => JSON.stringify(component)).reduce((json, one) => json.replace(one, () => `\n${one}`), JSON.stringify(written));
}

/** A call as its agent writes it. */
export function callJson({ messages, ...named }: Call): string {
  const fields = Object.entries(named).map(([key, value]) => `${JSON.stringify(key)}:${JSON.stringify(value)},`);
  return `{${fields.join("")}"messages":[\n${messages.map(messageJson).join(",\n")}]}`;
}
