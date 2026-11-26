/// <reference types="node" />
// Local images in a surface (#722), with Tauri's `invoke` and the page's blob URLs faked: what an
// `Image` and an image in Markdown ask Rust for, and what they draw.
import "../../test-support/dom.ts";
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement } from "react";
import type { SurfaceComponent, SurfaceRecord } from "./surfaceTypes.ts";
import { terminalInfo } from "../companion/fixtures/companionFixtures.ts";
import { acceptedAsk, called, calls, loadSurfaces, settle, startRust, unloadSurfaces, until, verdictOn } from "./fixtures/fakeRust.ts";
import { mount, redraw, surface, unmount } from "./fixtures/surfaceFixtures.ts";

const { SurfaceView } = await import("./SurfaceView.tsx");

const IMAGE = "surface_image";
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const bytes = (...head: number[]) => new Uint8Array(head).buffer;

/** The blob of each URL that was made, and the URLs that have been revoked, in order. */
const blobs = new Map<string, Blob>();
const revoked: string[] = [];
const { createObjectURL, revokeObjectURL } = URL;

/** What `surface_image` does with the path it is asked for. */
let onImage: (path: string) => unknown;

beforeEach(async () => {
  blobs.clear();
  revoked.length = 0;
  URL.createObjectURL = (blob) => {
    const url = `blob:http://localhost/${blobs.size + 1}`;
    blobs.set(url, blob as Blob);
    return url;
  };
  URL.revokeObjectURL = (url) => void revoked.push(url);
  onImage = () => bytes(...PNG);
  startRust({ surface_list: () => [], surface_checks: () => [], [IMAGE]: ({ path }) => onImage(String(path)) });
  loadSurfaces();
  await settle();
  calls.length = 0;
});
afterEach(async () => {
  await unmount();
  unloadSurfaces();
  Object.assign(URL, { createObjectURL, revokeObjectURL });
});

/** A raw surface of `components` under a root Column, with `data` as its data model. */
function surfaceOf(components: SurfaceComponent[], data: Record<string, unknown> = {}, children = components.map(({ id }) => id)): SurfaceRecord {
  return surface("plan", {
    tool: "quay_surface",
    asks: false,
    state: {
      version: "1.0",
      createSurface: {
        surfaceId: "plan",
        catalogId: "urn:quay:a2ui:catalog:v1",
        components: [{ id: "root", component: "Column", children }, ...components],
        dataModel: data,
      },
    },
  });
}

const terminal = { ...terminalInfo("t1", "E:/alpha"), name: "fix-75" };
const view = (surfaces: SurfaceRecord[]) => createElement(SurfaceView, { terminal, surfaces });

/** Draws `record` in its frame and gives the box its content is in. */
async function draw(record: SurfaceRecord): Promise<HTMLElement> {
  const container = await mount(view([record]));
  await until(() => !container.textContent?.includes("Loading…"), "the surface was never drawn");
  await settle();
  return container.querySelector<HTMLElement>("[data-surface-content]")!;
}

const images = (within: HTMLElement) => [...within.querySelectorAll("img")];
const asked = () => called(IMAGE).map(({ path }) => path);
const image = (id: string, url: unknown, more: Record<string, unknown> = {}): SurfaceComponent => ({ id, component: "Image", url, ...more });

test("an Image shows the file Rust reads for its own surface, with its description as its name", async () => {
  const content = await draw(surfaceOf([image("a", "docs/chart.png", { description: "A chart" })]));

  assert.deepEqual(called(IMAGE), [{ terminalId: "t1", id: "plan", path: "docs/chart.png" }]);
  const [img, ...others] = images(content);
  assert.equal(others.length, 0);
  assert.equal(img.getAttribute("src"), "blob:http://localhost/1");
  assert.equal(img.getAttribute("alt"), "A chart");
  const blob = blobs.get("blob:http://localhost/1")!;
  assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())], PNG);
  assert.equal(blob.type, "image/png");
});

test("a blob URL is revoked when its surface goes, and one image drawn twice is read once", async () => {
  const content = await draw(surfaceOf([image("a", "a.png"), image("b", "a.png"), image("c", "c.png")]));
  assert.deepEqual(asked(), ["a.png", "c.png"]);
  assert.deepEqual(images(content).map((img) => img.getAttribute("src")), ["blob:http://localhost/1", "blob:http://localhost/1", "blob:http://localhost/2"]);
  assert.deepEqual(revoked, []);

  await redraw(view([]));
  assert.deepEqual([...revoked].sort(), ["blob:http://localhost/1", "blob:http://localhost/2"]);
  assert.equal(blobs.size, 2);
});

test("a surface that is answered or dismissed while an image is read makes no blob URL", async () => {
  let give: (read: ArrayBuffer) => void = () => {};
  onImage = () => new Promise((resolve) => (give = resolve));
  const content = await draw(surfaceOf([image("a", "a.png")]));
  assert.equal(images(content).length, 0);

  await redraw(view([]));
  await act(async () => give(bytes(...PNG)));
  await settle();
  assert.equal(blobs.size, 0);
  assert.deepEqual(revoked, []);
});

test("a read that comes after a later one for the same image does not replace it", async () => {
  const reads = new Map<string, (read: ArrayBuffer) => void>();
  onImage = (path) => new Promise((resolve) => reads.set(path, resolve));
  const record = surfaceOf([image("a", { "@path": "/shot" }, { description: "Shot" }), { id: "field", component: "TextField", label: "Shot", value: { "@path": "/shot" } }], { shot: "old.png" });
  const content = await draw(record);
  const field = content.querySelector<HTMLInputElement>("input, textarea")!;
  const type = async (text: string) => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), "value")!.set!.call(field, text);
    await act(async () => void field.dispatchEvent(new Event("input", { bubbles: true })));
    await settle();
  };
  await type("new.png");
  assert.deepEqual(asked(), ["old.png", "new.png"]);

  await act(async () => reads.get("new.png")!(bytes(...PNG)));
  await settle();
  assert.equal(images(content)[0].getAttribute("src"), "blob:http://localhost/1");
  await act(async () => reads.get("old.png")!(bytes(0xff, 0xd8, 0xff)));
  await settle();
  assert.deepEqual(images(content).map((img) => img.getAttribute("src")), ["blob:http://localhost/1"]);
  assert.equal(blobs.get("blob:http://localhost/1")!.type, "image/png");
  assert.equal(blobs.size, 1, "what the stale read gave is dropped");

  // Back to the first, which is read anew, and is not answered by its own earlier read
  onImage = (path) => new Promise((resolve) => reads.set(path, resolve));
  await type("old.png");
  assert.deepEqual(revoked, ["blob:http://localhost/1"]);
  assert.equal(images(content).length, 0);
  await act(async () => reads.get("old.png")!(bytes(0xff, 0xd8, 0xff)));
  await settle();
  assert.equal(blobs.get(images(content)[0].getAttribute("src")!)!.type, "image/jpeg");
});

test("a surface that comes back to the screen has its images read again", async () => {
  const record = surfaceOf([image("a", "a.png")]);
  await draw(record);
  await redraw(view([]));
  await redraw(view([record]));
  await settle();
  assert.deepEqual(asked(), ["a.png", "a.png"]);
  assert.deepEqual(revoked, ["blob:http://localhost/1"]);
});

/** The lines of each box that stands for an image that is not shown. */
const boxes = (within: HTMLElement) => [...within.querySelectorAll<HTMLElement>("[data-image-refused]")].map((box) => [...box.children].map((line) => line.textContent));

test("what Rust refuses draws a box with the description, the reason and the address", async () => {
  const reasons: Record<string, string> = { "gone.png": "There is no such file.", "//host/share/x.png": "It is not a file on this computer, or Quay cannot tell that it is." };
  onImage = (path) => Promise.reject(reasons[path]);
  const content = await draw(surfaceOf([image("a", "gone.png", { description: "The <b>chart</b>" }), image("b", "//host/share/x.png")]));

  assert.deepEqual(boxes(content), [
    ["The <b>chart</b>", "There is no such file.", "gone.png"],
    ["It is not a file on this computer, or Quay cannot tell that it is.", "//host/share/x.png"],
  ]);
  assert.equal(content.querySelectorAll("img, b, [src], [href]").length, 0);
  assert.equal(blobs.size, 0);
});

test("a web address, a data: URI and what is no path draw the box, and nothing is asked for or fetched", async () => {
  const fetched: unknown[] = [];
  const { fetch } = globalThis;
  globalThis.fetch = async (...args) => (fetched.push(args), new Response());
  const web = "Quay loads no image from the web.";
  const inline = "Quay shows an image only from a file.";
  const none = "It is not a path Quay can open.";
  const cases = [
    ["https://a.example/x.png", web],
    ["HTTP://a.example/x.png", web],
    ["https:a.png", web],
    ["data:image/png;base64,iVBORw0KGgo=", inline],
    ["DATA:image/svg+xml,<svg/onload=alert(1)>", inline],
    ["blob:http://localhost/1", none],
    ["asset://localhost/x.png", none],
    ["javascript:alert(1)", none],
    ["a‮gnp.exe", none],
    ["", "It names no file."],
  ];
  const content = await draw(surfaceOf(cases.map(([url], i) => image(`i${i}`, url))));

  assert.deepEqual(boxes(content), cases.map(([url, why]) => [why, ...(url === "" ? [] : [url.replace("‮", " ")])]));
  assert.deepEqual(calls, []);
  assert.deepEqual(fetched, []);
  assert.equal(content.querySelectorAll("img, [src], [href]").length, 0);
  globalThis.fetch = fetch;
});

test("a long address is cut in the box", async () => {
  const content = await draw(surfaceOf([image("a", `data:image/png;base64,${"A".repeat(100_000)}`)]));
  const [[, address]] = boxes(content);
  assert.ok(address!.length <= 201 && address!.endsWith("…"), String(address!.length));
});

test("a file that the webview cannot draw draws the box", async () => {
  const content = await draw(surfaceOf([image("a", "a.png", { description: "Shot" })]));
  await act(async () => void images(content)[0].dispatchEvent(new Event("error")));
  assert.deepEqual(boxes(content), [["Shot", "It could not be drawn.", "a.png"]]);
  assert.equal(images(content).length, 0);
});

test("a reading has nothing to fetch, and says that it is under way", async () => {
  onImage = () => new Promise(() => {});
  const content = await draw(surfaceOf([image("a", "a.png", { description: "Shot" })]));
  assert.equal(content.textContent, "Reading the image: Shot");
  assert.equal(images(content).length, 0);
});

test("how a reading ends is said in the status that said it was under way", async () => {
  const ends = new Map<string, { give: (read: ArrayBuffer) => void; refuse: (why: string) => void }>();
  onImage = (path) => new Promise((give, refuse) => ends.set(path, { give, refuse }));
  const content = await draw(surfaceOf([image("a", "a.png"), image("b", "b.png"), image("web", "https://a.example/x.png")]));
  const [first, second, ...others] = content.querySelectorAll('[role="status"]');
  assert.equal(others.length, 0, "what is refused from the start is no change");
  assert.deepEqual([first.textContent, second.textContent], ["Reading the image", "Reading the image"]);

  await act(async () => ends.get("a.png")!.refuse("There is no such file."));
  await act(async () => ends.get("b.png")!.give(bytes(...PNG)));
  await settle();
  assert.equal(first.isConnected && second.isConnected, true);
  assert.deepEqual([first.textContent, second.textContent], ["There is no such file.a.png", ""]);
  assert.equal(second.contains(images(content)[0]), false);

  await act(async () => void images(content)[0].dispatchEvent(new Event("error")));
  assert.equal(second.textContent, "It could not be drawn.b.png");
});

test("an image goes by its accessibility label, then its description, and with neither only decorates", async () => {
  const content = await draw(
    surfaceOf(
      [
        image("a", "a.png", { description: "Described" }),
        image("b", "b.png", { description: "Described", "@accessibility": { label: "Labelled" } }),
        image("c", "c.png", { "@accessibility": { label: { "@path": "/name" } } }),
        image("d", "d.png"),
        image("e", "e.png", { description: "" }),
        image("f", "f.png", { description: "Described", "@accessibility": { label: "" } }),
        image("g", "g.png", { description: { "@path": "/none" } }),
      ],
      { name: "Bound" },
    ),
  );
  assert.deepEqual(images(content).map((img) => img.getAttribute("alt")), ["Described", "Labelled", "Bound", "", "", "Described", ""]);
  assert.ok(images(content).every((img) => img.getAttribute("title") === null));
});

test("an image's variant and fit are its size and how it fills it, and none is wider than its surface", async () => {
  const variants = ["icon", "avatar", "smallFeature", "mediumFeature", "largeFeature", "header"];
  const fits = { contain: "object-contain", cover: "object-cover", fill: "object-fill", none: "object-none", scaleDown: "object-scale-down" };
  const content = await draw(
    surfaceOf([
      ...variants.map((variant) => image(`v_${variant}`, "a.png", { variant })),
      ...Object.keys(fits).map((fit) => image(`f_${fit}`, "a.png", { fit })),
      image("plain", "a.png"),
    ]),
  );
  const drawn = images(content).map((img) => img.className);
  assert.equal(new Set(drawn.slice(0, variants.length)).size, variants.length, "each variant has a look");
  assert.deepEqual(drawn.slice(variants.length, -1).map((name) => name.split(" ").find((part) => part.startsWith("object-"))), Object.values(fits));
  assert.equal(drawn[drawn.length - 1], drawn[variants.indexOf("mediumFeature")], "the standard's own default");
  assert.ok(drawn.every((name) => name.split(" ").includes("max-w-full")));
});

const text = (id: string, markdown: unknown): SurfaceComponent => ({ id, component: "Text", text: markdown });

test("an image in Markdown shows the file, named by its text", async () => {
  const content = await draw(
    surfaceOf([text("a", "Before ![a **bold** `chart`](docs/a%20b.png 'a title') after\n\n- ![](<C:/Program Files/x.png>)\n\n[![linked](c.png)](docs/c.md)\n\n![ref][r]\n\n[r]: d.png")]),
  );
  assert.deepEqual(asked(), ["docs/a b.png", "C:/Program Files/x.png", "c.png", "d.png"]);
  assert.deepEqual(images(content).map((img) => img.getAttribute("alt")), ["a bold chart", "", "linked", "ref"]);
  assert.ok(content.textContent?.startsWith("Before  after"), content.textContent ?? "");
  assert.ok(images(content).every((img) => img.className.split(" ").includes("max-w-full") && !img.hasAttribute("title")));
  assert.equal(images(content)[2].closest('[role="link"]') !== null, true, "a link's image is its label");
});

/** The margin classes of `element` and of what holds it, up to `stop`. */
function marginsOf(element: Element, stop: Element): string[] {
  const found: string[] = [];
  for (let at: Element | null = element; at !== null && at !== stop; at = at.parentElement) found.push(...at.className.split(" ").filter((name) => /^-?m[trblxy]?-/.test(name)));
  return found;
}

test("images and their boxes beside each other in Markdown have room around each, and in a Row only the Row's gap", async () => {
  const content = await draw(
    surfaceOf([
      text("a", "![a](https://a.example/a.png)![b](https://a.example/b.png)![c](c.png)![d](d.png)"),
      { id: "row", component: "Row", children: ["e", "f"] },
      image("e", "https://a.example/e.png"),
      image("f", "f.png"),
    ], {}, ["a", "row"]),
  );
  const inText = [...content.querySelectorAll("p [data-image-refused], p img")];
  assert.equal(inText.length, 4);
  assert.deepEqual(inText.filter((drawn) => marginsOf(drawn, drawn.closest("p")!).length === 0).length, 0, "each in Markdown has a margin");
  const inRow = [...content.querySelectorAll("[data-image-refused], img")].filter((drawn) => drawn.closest("p") === null);
  assert.equal(inRow.length, 2);
  const row = (drawn: Element) => drawn.closest(".gap-2")!;
  assert.deepEqual(inRow.flatMap((drawn) => marginsOf(drawn, row(drawn))), [], "a Row's gap is all that is between them");
});

test("an image in Markdown that is no local path draws the box, and nothing is asked for", async () => {
  const content = await draw(
    surfaceOf([
      text("a", "![a chart](https://a.example/x.png)"),
      text("b", "![inline](data:image/png;base64,iVBORw0KGgo=)"),
      text("c", "![script](javascript:alert(1))"),
      text("d", "![nothing]()"),
      text("e", "see ![](blob:x) here"),
    ]),
  );
  assert.deepEqual(boxes(content), [
    ["a chart", "Quay loads no image from the web.", "https://a.example/x.png"],
    ["inline", "Quay shows an image only from a file.", "data:image/png;base64,iVBORw0KGgo="],
    ["script", "It is not a path Quay can open.", "javascript:alert(1)"],
    ["nothing", "It names no file."],
    ["It is not a path Quay can open.", "blob:x"],
  ]);
  assert.deepEqual(calls, []);
  assert.equal(content.querySelectorAll("img, [src], [href]").length, 0);
});

test("an image in Markdown whose address is written elsewhere in the text draws the box too", async () => {
  const content = await draw(
    surfaceOf([
      text("a", "![a chart][web] ![inline][data] ![script] and ![host][]\n\n[web]: https://a.example/x.png\n[data]: data:image/png;base64,iVBORw0KGgo=\n[script]: javascript:alert(1) 'a title'\n[host]: <blob:x>"),
    ]),
  );
  assert.deepEqual(boxes(content), [
    ["a chart", "Quay loads no image from the web.", "https://a.example/x.png"],
    ["inline", "Quay shows an image only from a file.", "data:image/png;base64,iVBORw0KGgo="],
    ["script", "It is not a path Quay can open.", "javascript:alert(1)"],
    ["host", "It is not a path Quay can open.", "blob:x"],
  ]);
  assert.equal(content.querySelectorAll("p").length, 1, "where the addresses are written is not drawn");
  assert.deepEqual(calls, []);
  assert.equal(content.querySelectorAll("img, [src], [href], [role]").length, 0);
});

test("a link to what is no path or web address shows its address, however it is written", async () => {
  const content = await draw(
    surfaceOf([text("a", "[*in*line](javascript:a) [titled](tel:1 'a title') [ref][r] [r] <mailto:a@a.example> <a@a.example> [empty]() [![z](blob:b)](blob:c)\n\n[r]: data:x")]),
  );
  assert.deepEqual(boxes(content), [["z", "It is not a path Quay can open.", "blob:b"]]);
  content.querySelector("[data-image-refused]")!.remove();
  assert.equal(
    content.textContent,
    '[inline](javascript:a) [titled](tel:1 "a title") [ref](data:x) [r](data:x) <mailto:a@a.example> <a@a.example> empty [](blob:c)',
  );
  assert.equal(content.querySelectorAll("em").length, 1);
  assert.equal(content.querySelectorAll("[role], [href]").length, 0);
});

test("a link in angle brackets inside a link's label is judged by its own address", async () => {
  const content = await draw(surfaceOf([text("a", "[a <tel:1> b](javascript:c) [d <tel:2> e](f.md) [g <https://h.example> i](javascript:j)")]));
  assert.deepEqual([...content.querySelectorAll('[role="link"]')].map((link) => link.textContent), ["d <tel:2> e", "https://h.example h.example"]);
  assert.equal(content.textContent, "[a <tel:1> b](javascript:c) d <tel:2> e [g https://h.example h.example i](javascript:j)");
});

test("a link to what is no path or web address is still text, also beside an image of the same address", async () => {
  const content = await draw(surfaceOf([text("a", "![x](javascript:a) [y](javascript:a) [![z](javascript:a)](javascript:a)")]));
  assert.equal(content.querySelectorAll('[role="link"]').length, 0);
  assert.ok(content.textContent?.includes("[y](javascript:a)"), content.textContent ?? "");
  assert.equal(boxes(content).length, 2);
});

test("inside a Button an image in Markdown is its text, and no file is asked for", async () => {
  const content = await draw(
    surfaceOf(
      [
        { id: "a", component: "Button", child: "a_label", action: { event: { name: "go" } } },
        text("a_label", "Send ![the chart](a.png)![](b.png)"),
      ],
      {},
      ["a"],
    ),
  );
  assert.equal(content.querySelector("button")!.textContent, "Send the chart![](b.png)");
  assert.deepEqual(asked(), []);
});

test("an image's text is its name as it reads, escapes and references included", async () => {
  const content = await draw(surfaceOf([text("a", "![a \\*b\\* &amp; c\nd \\[e\\] ![f](g.png)](x.png)")]));
  assert.deepEqual(images(content).map((img) => img.getAttribute("alt")), ["a *b* & c\nd [e] f"]);
  assert.deepEqual(asked(), ["x.png"]);
});

const question = (context: string, title = "Which?") => ({ context, questions: [{ question: title, options: [{ label: "Yes", recommended: false }, { label: "No", recommended: false }], multiple: false }] });

/** What the webview says of the images of an ask with this `context`. */
async function askedWith(call: number, context: string, title?: string) {
  const verdict = await verdictOn({ call, tool: "quay_ask", surface_id: "ask_1", arguments: question(context, title) });
  assert.ok("state" in verdict, JSON.stringify(verdict));
  return { images: verdict.images, image_paths: verdict.image_paths };
}

test("a check is answered with how many images the surface has, and the files they are of, each once", async () => {
  assert.deepEqual(await askedWith(1, "No image, `![not](one.png)`"), { images: 0, image_paths: [] });
  assert.deepEqual(
    await askedWith(2, "![a](docs/a%20b.png) ![b](https://a.example/x.png) ![c](data:image/png;base64,x)\n\n![again](docs/a%20b.png) ![d](//host/share/d.png) ![](e.png)"),
    { images: 6, image_paths: ["docs/a b.png", "//host/share/d.png", "e.png"] },
  );
  assert.deepEqual(await askedWith(3, "Text", "![q](question.png)?"), { images: 0, image_paths: [] }, "a question is plain text");
  assert.equal(asked().length, 0, "a check reads no file");
});

test("a surface names every file that drawing it asks for, and no other", async () => {
  const record = surfaceOf(
    [
      image("a", "a.png"),
      image("b", { "@path": "/bound" }),
      image("c", { "@path": "/shots/last" }),
      text("d", { "@path": "/markdown" }),
      { id: "list", component: "Column", children: { componentId: "item", path: "/items" } },
      { id: "item", component: "Column", children: ["item_image", "item_text"] },
      image("item_image", { "@path": "file" }),
      text("item_text", { "@path": "note" }),
      { id: "button", component: "Button", child: "button_column", action: { event: { name: "go" } } },
      { id: "button_column", component: "Column", children: ["button_image", "button_text"] },
      image("button_image", "icon.png"),
      text("button_text", "![not read](no.png)"),
      image("web", "https://a.example/x.png"),
      text("long", `![not read](long.png)${"x".repeat(20_000)}`),
      image("none", { "@path": "/none" }),
    ],
    {
      bound: "bound.png",
      shots: { last: "shots/n.png", first: "shots/unused.png" },
      markdown: "# ![m](m.png)\n\n| ![t](t.png) |\n| - |",
      items: [{ file: "1.png", note: "![](x.png)" }, { file: "2.png", note: "![](y.png)" }],
    },
    ["a", "b", "c", "d", "list", "button", "web", "long", "none"],
  );
  const { namedImages } = await import("./a2ui/images.ts");
  const { engineFor } = await import("./a2ui/engine.ts");
  const named = namedImages(engineFor(record.state).surface);
  assert.deepEqual(named, {
    images: 12,
    image_paths: ["a.png", "bound.png", "shots/n.png", "m.png", "t.png", "1.png", "x.png", "2.png", "y.png", "icon.png"],
  });

  await draw(record);
  assert.deepEqual([...asked()].sort(), [...named.image_paths].sort());
});

test("no file is asked for while a question is only a line, and none once it is answered", async () => {
  const first = await acceptedAsk("ask_1", question("![a](a.png)", "First?"), "t1", 1);
  const second = await acceptedAsk("ask_2", question("![b](b.png)", "Second?"), "t1", 2);
  calls.length = 0;
  await draw(first);
  await redraw(view([first, second]));
  await settle();
  assert.deepEqual(called(IMAGE), [{ terminalId: "t1", id: "ask_1", path: "a.png" }]);

  const answered = { ...first, change: 3, answer: { answers: [] }, answered_at: 1 };
  await redraw(view([answered, second]));
  await settle();
  assert.deepEqual(revoked, ["blob:http://localhost/1"]);
  assert.deepEqual(called(IMAGE).slice(1), [{ terminalId: "t1", id: "ask_2", path: "b.png" }]);
});
