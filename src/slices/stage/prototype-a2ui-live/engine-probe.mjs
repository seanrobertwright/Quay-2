// PROTOTYPE (#711), throwaway. What the engine alone says, outside the webview:
// node src/slices/stage/prototype-a2ui-live/engine-probe.mjs
import { createComponentImplementation as mk } from "@a2ui/react";
import * as C from "@a2ui/web_core/v1_0";

const ID = "urn:quay:a2ui:catalog:v1";
const catalog = C.basicCatalog.derive({
  catalogId: ID,
  components: [C.TextApi, C.ColumnApi, C.ButtonApi, C.TextFieldApi].map((api) => mk(api, () => null)),
});
const actions = [];
const processor = () => new C.MessageProcessor([catalog], (a) => actions.push(a), { validationConfig: C.STRICT_VALIDATION, version: "1.0" });
const create = () => ({
  version: "1.0",
  createSurface: {
    surfaceId: "s",
    catalogId: ID,
    components: [
      { id: "root", component: "Column", children: ["a", "f", "go"] },
      { id: "a", component: "Text", text: "hi" },
      { id: "f", component: "TextField", label: "L", value: { "@path": "/note" } },
      {
        id: "go",
        component: "Button",
        child: "gl",
        "@checks": [{ condition: { "@path": "/frame/ready" }, message: "no" }],
        action: { event: { name: "send", context: { n: { "@path": "/note" } } } },
      },
      { id: "gl", component: "Text", text: "Go" },
    ],
    dataModel: { note: "x", keep: 1 },
  },
});
const update = (body) => ({ version: "1.0", updateComponents: { surfaceId: "s", components: body } });
const data = (body) => ({ version: "1.0", updateDataModel: { surfaceId: "s", ...body } });
const fresh = () => {
  const p = processor();
  p.processMessages([create()]);
  return p;
};
const say = (name, f) => {
  try {
    console.log("OK ", name, "->", JSON.stringify(f()));
  } catch (e) {
    console.log("ERR", name, "-> thrown code", e.code, "| mapped", JSON.stringify(C.mapErrorToRendererMessage(e, { surfaceId: "s", version: "1.0" }).error));
  }
};

say("an update that drops a child", () => fresh().processMessages([update([{ id: "root", component: "Column", children: ["f", "go"] }])]));
say("the same as delete and create in one batch", () => {
  const p = fresh();
  const c = create();
  c.createSurface.components = c.createSurface.components.filter((x) => x.id !== "a");
  c.createSurface.components[0].children = ["f", "go"];
  p.processMessages([{ version: "1.0", deleteSurface: { surfaceId: "s" } }, c]);
  return [...p.getSurface("s").componentsModel.keys];
});
say("an update with part of a component", () => fresh().processMessages([update([{ id: "f", component: "TextField", label: "new" }])]));
for (const body of [{ value: { z: 1 } }, { path: "/", value: { z: 1 } }, { path: "/note" }, { path: "/a/b/0/c", value: 3 }])
  say(`updateDataModel ${JSON.stringify(body)}`, () => {
    const p = fresh();
    p.getSurface("s").dataModel.set("/frame/ready", true);
    p.processMessages([data(body)]);
    return p.getSurface("s").dataModel.get("/");
  });
say("createSurface for an id in use", () => fresh().processMessages([create()]));

// Does the engine itself hold an action whose @checks fail, or only report isValid?
const p = fresh();
const surface = p.getSurface("s");
const resolver = new C.NodeResolver(surface);
const root = C.peekValue(resolver.rootNode ?? resolver.root);
const stop = C.effect(() => void C.getValue(root.props));
const child = (name) => root.props && C.peekValue(root.props).children.find((n) => n.componentId === name);
const button = child("go");
const held = C.peekValue(button.props);
console.log("isValid with /frame/ready unset:", held.isValid, JSON.stringify(held.validationErrors));
await (typeof held.action === "function" ? held.action() : held.action?.dispatch?.());
console.log("actions after the held Button's own action is called:", actions.length);
surface.dataModel.set("/frame/ready", true);
console.log("isValid with /frame/ready true:", C.peekValue(button.props).isValid);
stop();
