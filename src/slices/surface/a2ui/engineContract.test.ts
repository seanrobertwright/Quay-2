/// <reference types="node" />
// What Quay builds on of the engine (#725): each case of the spec's table of engine 0.16.1, run on the
// packages themselves. An upgrade that changes one fails here, and is then Quay's to follow.
import "../../../test-support/dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { act, createContext, createElement, useContext, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { z } from "zod";
import { A2uiSurface, createComponentImplementation, type ReactCatalogComponent } from "@a2ui/react";
import { basicCatalog, ButtonApi, ChoicePickerApi, ColumnApi, OpenUrlApi, TextApi, TextFieldApi } from "@a2ui/web_core/catalogs/basic/v1";
import {
  createFunctionImplementation,
  mapErrorToRendererMessage,
  MessageProcessor,
  STRICT_VALIDATION,
  type ActionListener,
  type Catalog,
} from "@a2ui/web_core/v1_0";

type Json = Record<string, unknown>;

/** What was opened or copied. */
const caused: string[] = [];

interface Parts {
  shown: string[];
}

/** The layout the root Column hands its parts to. */
const LayoutOf = createContext<Parts | null>(null);

const LaidOut = ({ all, part }: { all: ReactNode; part: (id: string) => ReactNode }) => {
  const layout = useContext(LayoutOf);
  return layout ? layout.shown.map((id) => createElement("section", { key: id, "data-part": id }, part(id))) : all;
};

const COMPONENTS: ReactCatalogComponent[] = [
  createComponentImplementation(ColumnApi, ({ props, buildChild }) => {
    const ids = Array.isArray(props.children) ? props.children.filter((child) => typeof child === "string") : [];
    return createElement(LaidOut, { all: ids.map((id) => buildChild(id)), part: (id) => buildChild(id) });
  }),
  createComponentImplementation(TextApi, ({ props }) => createElement("span", null, JSON.stringify(props.text))),
  createComponentImplementation(TextFieldApi, ({ props }) =>
    createElement("input", { "aria-label": props.label, value: props.value ?? "", onInput: (e: { currentTarget: HTMLInputElement }) => props.setValue(e.currentTarget.value), onChange: () => {} }),
  ),
  // Whatever its checks say, so the engine's own hold is what is seen
  createComponentImplementation(ButtonApi, ({ props, buildChild }) =>
    createElement("button", { "data-valid": String(props.isValid), onClick: () => void props.action() }, props.child && buildChild(props.child)),
  ),
  createComponentImplementation(
    {
      ...ChoicePickerApi,
      schema: ChoicePickerApi.schema.extend({ options: z.array(ChoicePickerApi.schema.shape.options.element.extend({ recommended: z.boolean().optional() }).strict()) }),
    },
    ({ props }) => createElement("i", null, props.options.map((option) => option.label).join()),
  ),
  createComponentImplementation({ name: "Stat", schema: z.object({ value: z.string() }).strict() }, ({ props }) => createElement("b", null, props.value)),
];

const FUNCTIONS = [
  createFunctionImplementation(OpenUrlApi, ({ url }) => void caused.push(String(url))),
  createFunctionImplementation(
    { name: "copyText", returnType: "void", allowedCallers: "rendererOnly", schema: z.object({ text: z.string() }).strict() } as const,
    ({ text }) => void caused.push(text),
  ),
];

const ID = "urn:quay:contract";
const derived = basicCatalog.derive({ catalogId: ID, components: COMPONENTS, functions: FUNCTIONS }) as Catalog<ReactCatalogComponent>;

const engine = (onAction?: ActionListener) =>
  new MessageProcessor<ReactCatalogComponent>([derived], onAction, { validationConfig: STRICT_VALIDATION, version: "1.0" });

const create = (components: unknown, more: Json = {}): Json => ({ version: "1.0", createSurface: { surfaceId: "s", catalogId: ID, components, ...more } });
const column = (...components: Json[]): Json[] => [{ id: "root", component: "Column", children: components.map(({ id }) => id) }, ...components];
const said = { id: "said", component: "Text", text: "x" };
const button = (more: Json = {}): Json[] => [
  { id: "root", component: "Column", children: ["go"] },
  { id: "go", component: "Button", child: "label", action: { event: { name: "go", context: {} } }, ...more },
  { id: "label", component: "Text", text: "Go" },
];

/** What processing `messages` throws, or null: its own code, and what the engine's mapping tells of it. */
function thrownBy(messages: Json[], processor = engine()) {
  try {
    processor.processMessages(messages);
    return null;
  } catch (error) {
    const { code, path, message } = mapErrorToRendererMessage(error, { surfaceId: "s", version: "1.0" }).error;
    return { thrown: (error as { code?: string }).code, code, path, message };
  }
}

const accepts = (components: Json[], more?: Json) => assert.deepEqual(thrownBy([create(components, more)]), null, JSON.stringify(components));
const codeOf = (found: ReturnType<typeof thrownBy>) => [found?.code, found?.path];

test("@accessibility and @checks are accepted", () => {
  accepts(button({ "@accessibility": { label: "x" }, "@checks": [{ condition: { "@path": "/ready" }, message: "x" }] }));
});

test("bare accessibility and checks, and bare path and call bindings, are accepted, which is why there is a pre-pass", () => {
  accepts(button({ accessibility: { label: "x" }, checks: [{ condition: { "@path": "/ready" }, message: "x" }] }));
  accepts(column({ ...said, text: { path: "/a" } }));
  accepts(column({ ...said, text: { call: "openUrl", args: { url: "x" } } }));
});

test("theme is rejected", () => {
  assert.deepEqual(codeOf(thrownBy([create(column(said), { theme: {} })])), ["VALIDATION_FAILED", "/theme"]);
});

test("version v0.9 and v0.9.1 are read by the 0.9 adapter and not refused as a version, which is why there is a pre-pass", () => {
  for (const version of ["v0.9", "v0.9.1"]) {
    const found = thrownBy([{ ...create(column(said)), version }]);
    assert.match(found!.message, /^Invalid v0\.9[.\d]* message: createSurface: Unrecognized key\(s\) in object: 'components'/, version);
  }
});

test("no root, a dangling child and an orphan are INTEGRITY_ERROR with no path, and name the component", () => {
  const cases: [Json[], RegExp][] = [
    [[said], /^Missing root component: No component has id='root'$/],
    [[...column(said), { id: "more", component: "Column", children: ["nowhere"] }], /^Component 'more' references/],
    [[...column(said), { ...said, id: "lost" }], /^Component 'lost' is not reachable/],
  ];
  for (const [components, message] of cases) {
    const found = thrownBy([create(components)]);
    assert.deepEqual(codeOf(found), ["INTEGRITY_ERROR", undefined]);
    assert.match(found!.message, message);
  }
});

test("a cycle is RECURSION_LIMIT_EXCEEDED with no path, and names a component", () => {
  const cases: [Json[], RegExp][] = [
    [[{ id: "root", component: "Column", children: ["in"] }, { id: "in", component: "Column", children: ["root"] }], /component 'in'|component 'root'/],
    [[{ id: "root", component: "Column", children: ["root"] }], /Component 'root' references itself/],
  ];
  for (const [components, message] of cases) {
    const found = thrownBy([create(components)]);
    assert.deepEqual(codeOf(found), ["RECURSION_LIMIT_EXCEEDED", undefined]);
    assert.match(found!.message, message);
  }
});

test("an unknown component, an unknown function and a bad property are thrown as VALIDATION_ERROR and mapped to VALIDATION_FAILED with a path inside the message body", () => {
  const cases: [Json, string, RegExp][] = [
    [{ id: "x", component: "Carousel" }, "/components/1/component", /^Unknown component type 'Carousel' not found in catalog/],
    [{ ...said, text: { "@call": "shout", args: {} } }, "/components/1/text", /^Unrecognized function 'shout'/],
    [{ ...said, variant: "h2" }, "/components/1/variant", /^Validation failed for component 'Text' \(said\): /],
  ];
  for (const [component, path, message] of cases) {
    const found = thrownBy([create(column(component))]);
    assert.deepEqual([found?.thrown, found?.code, found?.path], ["VALIDATION_ERROR", "VALIDATION_FAILED", path]);
    assert.match(found!.message, message);
  }
});

/** Draws the surface `s` of `processor` in the page, with the layout `shown` when there is one. */
async function draw(processor: ReturnType<typeof engine>) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const show = (shown?: string[]) =>
    act(async () => root.render(createElement(LayoutOf.Provider, { value: shown ? { shown } : null }, createElement(A2uiSurface, { surface: processor.model.getSurface("s")! }))));
  await show();
  return {
    container,
    show,
    unmount: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

test("a Button's action called while its checks fail is dispatched, which is why Quay's Button holds it", async () => {
  const sent: string[] = [];
  const processor = engine(({ name }) => void sent.push(name));
  processor.processMessages([create(button({ "@checks": [{ condition: { "@path": "/ready" }, message: "x" }] }), { dataModel: { ready: false } })]);
  const { container, unmount } = await draw(processor);
  const go = container.querySelector("button")!;
  assert.equal(go.dataset.valid, "false");
  await act(async () => go.click());
  assert.deepEqual(sent, ["go"]);
  await unmount();
});

const update = (kind: string, body: Json): Json => ({ version: "1.0", [kind]: { surfaceId: "s", ...body } });

test("an update that leaves a child out of its parent is INTEGRITY_ERROR for the orphan", () => {
  const processor = engine();
  processor.processMessages([create(column(said, { ...said, id: "other" }))]);
  const found = thrownBy([update("updateComponents", { components: [{ id: "root", component: "Column", children: ["said"] }] })], processor);
  assert.deepEqual(codeOf(found), ["INTEGRITY_ERROR", undefined]);
  assert.match(found!.message, /^Component 'other' is not reachable/);
});

test("updateDataModel with no path, or /, replaces the whole model, /frame included", () => {
  for (const path of [{}, { path: "/" }]) {
    const processor = engine();
    processor.processMessages([create(column(said), { dataModel: { a: 1, frame: { ready: true } } }), update("updateDataModel", { ...path, value: { b: 2 } })]);
    assert.deepEqual(processor.model.getSurface("s")!.dataModel.get("/"), { b: 2 });
  }
});

test("of several errors in one message only the first is told", () => {
  const found = thrownBy([create(column({ ...said, variant: "h2" }, { id: "x", component: "Carousel" }))]);
  assert.deepEqual([found?.path, /Carousel/.test(found!.message)], ["/components/1/variant", false]);
});

test("a message before one that fails is applied, which is why there is a scratch copy", () => {
  const processor = engine();
  const second = update("updateDataModel", { path: "/a/b", value: 2 });
  assert.equal(thrownBy([create(column(said), { dataModel: { a: 1 } }), second], processor)?.code, "DATA_ERROR");
  assert.deepEqual(processor.model.getSurface("s")?.dataModel.get("/"), { a: 1 });
});

test("an effect as a Text value or in a check is accepted, which is why there is a post-check", () => {
  accepts(column({ ...said, text: { "@call": "openUrl", args: { url: "https://quay.example" } } }));
  accepts(column({ ...said, text: { "@call": "copyText", args: { text: "x" } } }));
  accepts(button({ "@checks": [{ condition: { "@call": "openUrl", args: { url: "https://quay.example" } }, message: "x" }] }));
});

test("a catalog derived under a new id, with an extended ChoicePicker, an added component and a replaced openUrl, builds and validates, and no function is fired", () => {
  caused.length = 0;
  const picker = { id: "pick", component: "ChoicePicker", variant: "mutuallyExclusive", options: [{ label: "A", value: "a", recommended: true }], value: { "@path": "/pick" } };
  const [, go, label] = button({ action: { functionCall: { "@call": "openUrl", args: { url: "https://quay.example" } } } });
  accepts([{ id: "root", component: "Column", children: ["pick", "stat", "go"] }, picker, { id: "stat", component: "Stat", value: "1" }, go, label]);
  assert.equal(thrownBy([create(column({ ...picker, options: [{ label: "A", value: "a", extra: 1 }] }))])?.code, "VALIDATION_FAILED");
  assert.deepEqual([derived.id, caused], [ID, []]);
});

/** Types `text` into a field as the operator would. */
async function type(field: HTMLInputElement, text: string): Promise<void> {
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), "value")!.set!.call(field, text);
  await act(async () => void field.dispatchEvent(new Event("input", { bubbles: true })));
}

const FIELDS = (): Json[] => [
  { id: "root", component: "Column", children: ["name", "go"] },
  { id: "name", component: "TextField", label: "Name", value: { "@path": "/name" } },
  { id: "go", component: "Button", child: "label", action: { event: { name: "go", context: { name: { "@path": "/name" } } } } },
  { id: "label", component: "Text", text: { "@path": "/label" } },
];

test("the operator's input is not written into the message that was handed over", async () => {
  const message = create(FIELDS(), { dataModel: { name: "agent's" } });
  const processor = engine();
  processor.processMessages([message]);
  const { container, unmount } = await draw(processor);
  await type(container.querySelector("input")!, "operator's");
  assert.equal(processor.model.getSurface("s")!.dataModel.get("/name"), "operator's");
  assert.deepEqual((message.createSurface as Json).dataModel, { name: "agent's" });
  await unmount();
});

test("a root Column hands its named parts to a layout: a part taken away and back, an action and an agent's update keep the input", async () => {
  const sent: unknown[] = [];
  const processor = engine(({ context }) => void sent.push(context));
  processor.processMessages([create(FIELDS(), { dataModel: { name: "", label: "Go" } })]);
  const { container, show, unmount } = await draw(processor);
  const parts = () => [...container.querySelectorAll<HTMLElement>("[data-part]")].map((part) => part.dataset.part);

  await show(["go", "name"]);
  assert.deepEqual(parts(), ["go", "name"], "in the layout's own order");
  await type(container.querySelector("input")!, "kept");
  await show(["go"]);
  assert.equal(container.querySelectorAll("input").length, 0);
  await show(["name", "go"]);
  assert.equal(container.querySelector("input")!.value, "kept");

  await act(async () => processor.processMessages([update("updateDataModel", { path: "/label", value: "Send" })]));
  assert.deepEqual([container.querySelector("button")!.textContent, container.querySelector("input")!.value], ['"Send"', "kept"]);
  await act(async () => container.querySelector("button")!.click());
  assert.deepEqual(sent, [{ name: "kept" }]);
  await unmount();
});

test("a surface of 499 children is validated and applied", () => {
  const processor = engine();
  processor.processMessages([create(column(...Array.from({ length: 499 }, (_, i) => ({ ...said, id: `t${i}` }))))]);
  assert.equal([...processor.model.getSurface("s")!.componentsModel.values].length, 500);
});

test("a message with a type of the engine's own skips the schema, which is why the pre-pass takes no other key", () => {
  const processor = engine();
  processor.processMessages([create(column(said))]);
  assert.equal(thrownBy([{ version: "1.0", type: "updateDataModel", surfaceId: "s", path: "/a", value: 1, extra: 1 }], processor), null);
  assert.deepEqual(processor.model.getSurface("s")!.dataModel.get("/"), { a: 1 });
});

test("data in the shape of a call is data, and is not called", async () => {
  caused.length = 0;
  const processor = engine();
  processor.processMessages([create(column({ ...said, text: { "@path": "/a" } }), { dataModel: { a: { "@call": "openUrl", args: { url: "https://quay.example" } } } })]);
  const { container, unmount } = await draw(processor);
  assert.deepEqual([container.textContent, caused], ['{"@call":"openUrl","args":{"url":"https://quay.example"}}', []]);
  await unmount();
});
