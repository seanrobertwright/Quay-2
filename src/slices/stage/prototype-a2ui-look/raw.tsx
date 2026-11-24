// PROTOTYPE (#696), throwaway. A raw surface: A2UI 1.0 wire messages through the official engine
// (@a2ui/react 0.15.0, STRICT_VALIDATION), drawn by Quay's own Tailwind components in place of the
// stock Lit elements. Round two draws under a catalog id of Quay's own (#700): ChoicePicker's options
// gain description and recommended, and Steps, Progress, Stat and FileLink are added.
import { useContext, useEffect, useId, useState, type ReactNode } from "react";
import { z } from "zod";
import { A2uiSurface, createComponentImplementation, type ReactCatalogComponent } from "@a2ui/react/v0_9";
import * as core from "@a2ui/web_core/v1_0";
import { PRIMARY, SECONDARY } from "../../companion/buttonStyles.ts";
import { StatChip, StepColumns } from "./board.tsx";
import { FileLink, ImageBox, LooksContext } from "./frame.tsx";
import { Md } from "./md.tsx";

type Build = (id: string, base?: string) => ReactNode;
const C = core as any;
const CATALOG_ID = "https://quay.app/a2ui/catalog/v1";
const make = (api: any, View: (p: { props: any; buildChild: Build }) => ReactNode) => createComponentImplementation(api, View as any) as ReactCatalogComponent;
const kids = (children: any, buildChild: Build) => (Array.isArray(children) ? children : []).map((c: any) => (typeof c === "string" ? buildChild(c) : buildChild(c.id, c.basePath)));

const TextField = ({ props }: { props: any }) => {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="text-[11px] text-[#8b949e]">
        {props.label}
      </label>
      <input
        id={id}
        value={props.value ?? ""}
        onChange={(e) => props.setValue?.(e.target.value)}
        className="mt-0.5 w-full h-7 px-2 rounded-md bg-[#010409] border border-[#30363d] text-xs text-[#c9d1d9]"
      />
    </div>
  );
};
const Slider = ({ props }: { props: any }) => {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="flex text-[11px] text-[#8b949e]">
        <span className="flex-1">{props.label}</span>
        <span className="font-mono text-[#f0f6fc]">{props.value}</span>
      </label>
      <input id={id} type="range" min={props.min ?? 0} max={props.max} value={props.value ?? 0} onChange={(e) => props.setValue?.(Number(e.target.value))} className="w-full accent-[#58a6ff]" />
    </div>
  );
};

const ChoicePickerApi = {
  name: "ChoicePicker",
  schema: C.ChoicePickerApi.schema.extend({
    options: z.array(z.object({ label: z.string(), value: z.string(), description: z.string().optional(), recommended: z.boolean().optional() }).strict()),
  }),
};
const ChoicePicker = ({ props }: { props: any }) => {
  const id = useId();
  const many = props.variant === "multipleSelection";
  const value: string[] = props.value ?? [];
  return (
    <fieldset className="flex flex-col gap-1.5 min-w-0">
      {props.label && <legend className="text-[11px] text-[#8b949e] mb-1">{props.label}</legend>}
      {(props.options ?? []).map((o: any) => {
        const on = value.includes(o.value);
        return (
          <label key={o.value} className={`flex items-start gap-2 px-2.5 py-2 rounded-md border cursor-pointer ${on ? "border-[#58a6ff] bg-[#1f6feb26]" : "border-[#30363d] hover:bg-[#21262d]"}`}>
            <input
              type={many ? "checkbox" : "radio"}
              name={id}
              checked={on}
              onChange={() => props.setValue?.(many ? (on ? value.filter((v) => v !== o.value) : [...value, o.value]) : [o.value])}
              className="mt-0.5 accent-[#58a6ff] shrink-0"
            />
            <span className="min-w-0 flex-1">
              <span className="flex items-start gap-2 text-xs text-[#f0f6fc]">
                <span className="min-w-0 flex-1 break-words">{o.label}</span>
                {o.recommended && <span className="shrink-0 px-1.5 rounded-full text-[10px] text-[#d2a8ff] border border-[#a371f7]/50">agent's pick</span>}
              </span>
              {o.description && <span className="block text-[11px] leading-4 text-[#8b949e] break-words">{o.description}</span>}
            </span>
          </label>
        );
      })}
    </fieldset>
  );
};
const Tabs = ({ props, buildChild }: { props: any; buildChild: Build }) => {
  const { tabs: look } = useContext(LooksContext);
  const [at, setAt] = useState(0);
  const id = useId();
  const tabs: { title: string; child: any }[] = props.tabs ?? [];
  const child = tabs[at]?.child;
  return (
    <div className="flex flex-col gap-2.5 min-w-0">
      {look === "C" ? (
        <div>
          <label htmlFor={id} className="sr-only">
            Section
          </label>
          <select id={id} value={at} onChange={(e) => setAt(Number(e.target.value))} className="w-full h-7 px-2 rounded-md bg-[#21262d] border border-[#30363d] text-xs text-[#c9d1d9]">
            {tabs.map((t, i) => (
              <option key={t.title} value={i}>
                {t.title}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <div className={look === "A" ? "flex overflow-x-auto border-b border-[#30363d]" : "flex overflow-x-auto p-0.5 gap-0.5 rounded-md border border-[#30363d] bg-[#010409]"}>
          {tabs.map((t, i) => (
            <button
              key={t.title}
              type="button"
              aria-pressed={i === at}
              onClick={() => setAt(i)}
              className={`shrink-0 text-xs ${look === "A" ? `px-2.5 py-1.5 border-b-2 ${i === at ? "border-[#58a6ff] text-white" : "border-transparent text-[#8b949e]"}` : `flex-1 px-2.5 h-6 rounded ${i === at ? "bg-[#30363d] text-white" : "text-[#8b949e]"}`}`}
            >
              {t.title}
            </button>
          ))}
        </div>
      )}
      <div key={at}>{child && (typeof child === "string" ? buildChild(child) : buildChild(child.id, child.basePath))}</div>
    </div>
  );
};
const DateTimeInput = ({ props }: { props: any }) => {
  const id = useId();
  const type = props.enableDate && props.enableTime ? "datetime-local" : props.enableTime ? "time" : "date";
  return (
    <div>
      <label htmlFor={id} className="text-[11px] text-[#8b949e]">
        {props.label}
      </label>
      <input
        id={id}
        type={type}
        value={props.value ?? ""}
        min={props.min}
        max={props.max}
        onChange={(e) => props.setValue?.(e.target.value)}
        className="mt-0.5 block h-7 px-2 rounded-md bg-[#010409] border border-[#30363d] text-xs text-[#c9d1d9]"
      />
    </div>
  );
};
const Progress = ({ props }: { props: any }) => (
  <div className="flex items-center gap-2 text-xs">
    {props.label && <span className="text-[#c9d1d9]">{props.label}</span>}
    <progress aria-label={props.label ?? "Progress"} value={props.done} max={props.total} className="flex-1 h-1.5 [&::-webkit-progress-bar]:bg-[#21262d] [&::-webkit-progress-bar]:rounded-full [&::-webkit-progress-value]:bg-[#58a6ff] [&::-webkit-progress-value]:rounded-full" />
    <span className="text-[#8b949e]">
      {props.done} of {props.total}
    </span>
  </div>
);

const QUAY: ReactCatalogComponent[] = [
  make(ChoicePickerApi, ({ props }) => <ChoicePicker props={props} />),
  make(C.TabsApi, ({ props, buildChild }) => <Tabs props={props} buildChild={buildChild} />),
  make(C.DateTimeInputApi, ({ props }) => <DateTimeInput props={props} />),
  make(C.DividerApi, () => <hr className="border-[#30363d]" />),
  make(C.ImageApi, ({ props }) => <ImageBox alt={props.description ?? ""} src={props.url} />),
  make({ name: "Progress", schema: z.object({ done: z.number(), total: z.number(), label: z.string().optional() }).strict() }, ({ props }) => <Progress props={props} />),
  make({ name: "Stat", schema: z.object({ label: z.string(), value: z.string() }).strict() }, ({ props }) => <StatChip label={props.label} value={props.value} />),
  make({ name: "FileLink", schema: z.object({ path: z.string(), line: z.number().optional(), label: z.string().optional() }).strict() }, ({ props }) => <FileLink path={props.path} label={props.label} />),
  make(
    { name: "Steps", schema: z.object({ steps: z.array(z.object({ label: z.string(), state: z.enum(["pending", "active", "done", "failed"]), note: z.string().optional() }).strict()) }).strict() },
    ({ props }) => <StepColumns steps={props.steps} />,
  ),
  make(C.TextApi, ({ props }) =>
    props.variant === "caption" ? <Md text={String(props.text ?? "")} className="text-[11px]" tone="text-[#8b949e]" /> : <Md text={String(props.text ?? "")} className="text-xs leading-[18px]" />,
  ),
  make(C.ColumnApi, ({ props, buildChild }) => <div className="flex flex-col gap-2 min-w-0">{kids(props.children, buildChild)}</div>),
  make(C.RowApi, ({ props, buildChild }) => <div className="flex flex-wrap gap-2 items-stretch">{kids(props.children, buildChild)}</div>),
  make(C.CardApi, ({ props, buildChild }) => <div className="flex-1 min-w-[5.5rem] rounded-md border border-[#30363d] bg-[#161b22] px-2.5 py-2">{props.child && buildChild(props.child)}</div>),
  make(C.ButtonApi, ({ props, buildChild }) => (
    <button type="button" disabled={props.isValid === false} onClick={() => props.action?.()} className={`${props.variant === "primary" ? PRIMARY : SECONDARY} self-start [&_p]:my-0`}>
      {props.child && buildChild(props.child)}
    </button>
  )),
  make(C.TextFieldApi, ({ props }) => <TextField props={props} />),
  make(C.CheckBoxApi, ({ props }) => (
    <label className="flex items-center gap-2 text-xs text-[#c9d1d9]">
      <input type="checkbox" checked={!!props.value} onChange={(e) => props.setValue?.(e.target.checked)} className="accent-[#58a6ff]" />
      {props.label}
    </label>
  )),
  make(C.SliderApi, ({ props }) => <Slider props={props} />),
];

/** Surfaces kept by key, so a card that goes away and comes back keeps what was typed into it. */
export const KEPT = new Map<string, any>();

export const RawSurface = ({ messages, onAction, keep }: { messages: readonly object[]; onAction: (text: string) => void; keep?: string }) => {
  const [state, setState] = useState<{ surface: any; error: string | null }>({ surface: null, error: null });
  useEffect(() => {
    const kept = keep && KEPT.get(keep);
    if (kept) {
      setState({ surface: kept, error: null });
      return;
    }
    try {
      const catalog = new C.Catalog(CATALOG_ID, "1.0", QUAY, [...C.basicCatalog.functions.values()]);
      const processor = new C.MessageProcessor([catalog], (a: any) => onAction(`${a.name} ${JSON.stringify(a.context ?? {})}`), { validationConfig: C.STRICT_VALIDATION });
      processor.processMessages(structuredClone(messages).map((m: any) => ({ ...m, createSurface: { catalogId: CATALOG_ID, ...m.createSurface } })));
      const surface = [...processor.model.surfacesMap.values()][0];
      if (keep) KEPT.set(keep, surface);
      setState({ surface, error: surface ? null : "The engine made no surface." });
    } catch (e) {
      setState({ surface: null, error: String((e as Error).message) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);
  if (state.error) return <pre className="text-[11px] text-[#ff7b72] whitespace-pre-wrap">{state.error}</pre>;
  return state.surface ? <A2uiSurface surface={state.surface} /> : null;
};
