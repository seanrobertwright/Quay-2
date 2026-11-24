// PROTOTYPE (#696), throwaway. A raw surface: A2UI 1.0 wire messages through the official engine
// (@a2ui/react 0.15.0, STRICT_VALIDATION), drawn by Quay's own Tailwind components in place of the
// stock Lit elements. The ones written here are the ones the sample surfaces use.
import { useEffect, useId, useState, type ReactNode } from "react";
import { A2uiSurface, createComponentImplementation, type ReactCatalogComponent } from "@a2ui/react/v0_9";
import * as core from "@a2ui/web_core/v1_0";
import { PRIMARY, SECONDARY } from "../../companion/buttonStyles.ts";
import { Md } from "./md.tsx";

type Build = (id: string, base?: string) => ReactNode;
const C = core as any;
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

const QUAY: ReactCatalogComponent[] = [
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

export const RawSurface = ({ messages, onAction }: { messages: readonly object[]; onAction: (text: string) => void }) => {
  const [state, setState] = useState<{ surface: any; error: string | null }>({ surface: null, error: null });
  useEffect(() => {
    try {
      const catalog = new C.Catalog(C.basicCatalog.id, "1.0", QUAY, [...C.basicCatalog.functions.values()]);
      const processor = new C.MessageProcessor([catalog], (a: any) => onAction(`${a.name} ${JSON.stringify(a.context ?? {})}`), { validationConfig: C.STRICT_VALIDATION });
      processor.processMessages(messages.map((m: any) => ({ ...m, createSurface: { catalogId: C.basicCatalog.id, ...m.createSurface } })));
      const surface = [...processor.model.surfacesMap.values()][0];
      setState({ surface, error: surface ? null : "The engine made no surface." });
    } catch (e) {
      setState({ surface: null, error: String((e as Error).message) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);
  if (state.error) return <pre className="text-[11px] text-[#ff7b72] whitespace-pre-wrap">{state.error}</pre>;
  return state.surface ? <A2uiSurface surface={state.surface} /> : null;
};
