// Writes the calls' argument files.
import { writeFileSync } from "node:fs";
const dir = "C:/scratch/q711/args/";
const w = (n, v) => writeFileSync(`${dir}${n}.json`, JSON.stringify(v));
w("ask", {
  context: "The branch is **four commits** behind `master`.",
  questions: [
    {
      question: "Which base should this branch take?",
      options: [
        { label: "Rebase onto master", description: "Four commits, no conflicts expected.", recommended: true },
        { label: "Merge master in", description: "Keeps the history as it is." },
      ],
    },
    { question: "What should the release note say about the new behaviour?" },
  ],
});
// The largest ask the limits allow: 600 + 4 x (200 + 6 x (60 + 120)).
const pad = (s, n) => (s + " lorem ipsum dolor sit amet".repeat(20)).slice(0, n);
w("ask-max", {
  context: pad("Context", 600),
  questions: [0, 1, 2, 3].map((q) => ({
    question: pad(`Question ${q}`, 200),
    multiple: q % 2 === 1,
    options: [0, 1, 2, 3, 4, 5].map((o) => ({ label: pad(`Option ${q}.${o}`, 60), description: pad("Because", 120), recommended: o === 1 })),
  })),
});
const raw = (id, components, dataModel = {}) => ({
  place: "companion",
  title: `Raw ${id}`,
  messages: [{ version: "1.0", createSurface: { surfaceId: id, components, dataModel } }],
});
w(
  "raw",
  raw(
    "form",
    [
      { id: "root", component: "Column", children: ["status", "note", "owner", "agree", "pick", "go"] },
      { id: "status", component: "Text", text: { "@path": "/status" } },
      { id: "note", component: "TextField", variant: "longText", label: "Note", value: { "@path": "/note" } },
      { id: "owner", component: "TextField", label: "Owner", value: { "@path": "/meta/owner" } },
      { id: "agree", component: "CheckBox", label: "Run the suite", value: { "@path": "/agree" } },
      { id: "pick", component: "ChoicePicker", label: "Where", options: [{ label: "Here", value: "here" }, { label: "There", value: "there" }], value: { "@path": "/where" } },
      { id: "go", component: "Button", child: "golabel", action: { event: { name: "go", context: { note: { "@path": "/note" }, owner: { "@path": "/meta/owner" }, agree: { "@path": "/agree" }, where: { "@path": "/where" } } } } },
      { id: "golabel", component: "Text", text: "Go" },
    ],
    { status: "step 1", note: "", meta: { owner: "alice", untouched: 7 }, agree: false, where: ["here"] },
  ),
);
const upd = (...m) => ({ messages: m.map((x) => ({ version: "1.0", ...x })) });
w("upd-status", upd({ updateDataModel: { surfaceId: "form", path: "/status", value: "step 2" } }));
w("upd-label", upd({ updateComponents: { surfaceId: "form", components: [{ id: "note", component: "TextField", variant: "longText", label: "Note (relabelled)", value: { "@path": "/note" } }] } }));
w("upd-owner", upd({ updateDataModel: { surfaceId: "form", path: "/meta/owner", value: "bob" } }));
w("upd-meta", upd({ updateDataModel: { surfaceId: "form", path: "/meta", value: { owner: "carol", untouched: 8 } } }));
w("upd-root", upd({ updateDataModel: { surfaceId: "form", value: { status: "all new", note: "agent's", meta: { owner: "dan" }, agree: true, where: ["there"] } } }));
// 500 components of mixed kinds: forty groups of a Card with a Column of a Row, Texts and inputs.
const many = (id, total, text = 60) => {
  const components = [];
  const groups = [];
  let n = 1;
  for (let g = 0; n < total; g++) {
    const kids = [];
    const start = components.length;
    const push = (c) => {
      if (n >= total) return false;
      components.push(c);
      n++;
      return true;
    };
    if (total - n < 3) {
      const t = `tail${g}`;
      push({ id: t, component: "Text", text: "tail" });
      groups.push(t);
      continue;
    }
    push({ id: `card${g}`, component: "Card", child: `col${g}` });
    const col = { id: `col${g}`, component: "Column", children: kids };
    push(col);
    for (let k = 0; k < 10 && n < total; k++) {
      const c =
        k === 8
          ? { id: `f${g}_${k}`, component: "TextField", label: `Field ${g}`, value: { "@path": `/rows/${g}/note` } }
          : k === 9
            ? { id: `f${g}_${k}`, component: "CheckBox", label: `Keep ${g}`, value: { "@path": `/rows/${g}/keep` } }
            : { id: `f${g}_${k}`, component: "Text", text: k % 2 ? pad(`Line ${k} of group ${g}`, text) : { "@path": `/rows/${g}/line` } };
      push(c);
      kids.push(c.id);
    }
    if (components.length > start) groups.push(`card${g}`);
  }
  const rows = groups.map((_, i) => ({ line: pad(`Row ${i}`, text), note: "", keep: true }));
  return raw(id, [{ id: "root", component: "Column", children: groups }, ...components], { rows });
};
const c500 = many("big", 500);
console.log(c500.messages[0].createSurface.components.length, JSON.stringify(c500).length);
w("big", c500);
w("big-text", many("bigtext", 500, 2000));
w("big-over", many("bigover", 501));
// The same, plus a Button that asks, so the call waits.
const asking = many("bigask", 498);
asking.messages[0].createSurface.components[0].children.push("bgo");
asking.messages[0].createSurface.components.push({ id: "bgo", component: "Button", child: "bgol", action: { event: { name: "go", context: {} } } }, { id: "bgol", component: "Text", text: "Go" });
w("big-ask", asking);
// A flat one, and one with the data model near its 256 kB limit.
w("flat", raw("flat", [{ id: "root", component: "Column", children: Array.from({ length: 499 }, (_, i) => `t${i}`) }, ...Array.from({ length: 499 }, (_, i) => ({ id: `t${i}`, component: "Text", text: `line ${i}` }))]));
const heavy = many("heavy", 500);
heavy.messages[0].createSurface.dataModel.blob = Array.from({ length: 1200 }, (_, i) => ({ id: i, text: pad("x", 170) }));
console.log("heavy data model bytes", JSON.stringify(heavy.messages[0].createSurface.dataModel).length);
w("heavy", heavy);
// A typed field on a surface whose data model is near the limit, to price the draft's diff.
w(
  "heavyform",
  raw(
    "heavyform",
    [
      { id: "root", component: "Column", children: ["n", "go"] },
      { id: "n", component: "TextField", variant: "longText", label: "Heavy note", value: { "@path": "/note" } },
      { id: "go", component: "Button", child: "gl", action: { event: { name: "go", context: { note: { "@path": "/note" } } } } },
      { id: "gl", component: "Text", text: "Go" },
    ],
    { note: "", blob: heavy.messages[0].createSurface.dataModel.blob },
  ),
);
w("bad", raw("bad", [{ id: "root", component: "Column", children: ["x"] }, { id: "x", component: "Marquee", text: "no" }]));
