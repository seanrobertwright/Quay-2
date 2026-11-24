// PROTOTYPE (#711), throwaway. Quay's catalog on engine 0.16.1: derived from the basic catalog, drawn
// by Quay's Tailwind components. The inputs are written again here so that labels, checks and long
// text follow the spec; the rest comes from the look prototype (#696).
import { createContext, useContext, useId, type ReactNode } from "react";
import { z } from "zod";
import { createComponentImplementation, type ReactCatalogComponent } from "@a2ui/react";
import * as core from "@a2ui/web_core/v1_0";
import { PRIMARY, SECONDARY } from "../../companion/buttonStyles.ts";
import { QUAY } from "../prototype-a2ui-look/raw.tsx";

const C = core as any;
export const CATALOG_ID = "urn:quay:a2ui:catalog:v1";
export const MAX_COMPONENTS = 500;

/** What the frame lays a surface's named parts out with; the root Column reads it. */
export type Layout = (part: (name: string) => ReactNode) => ReactNode;
export const LayoutContext = createContext<Layout | null>(null);

/** How often each component has drawn, for the measurements. */
export const draws: Record<string, number> = {};
export const drew = (name: string) => void (draws[name] = (draws[name] ?? 0) + 1);

const make = (api: any, View: (p: any) => ReactNode) => createComponentImplementation(api, View as any) as ReactCatalogComponent;
const kids = (children: any, buildChild: any) =>
  (Array.isArray(children) ? children : []).map((c: any) => (typeof c === "string" ? buildChild(c) : buildChild(c.id, c.basePath)));

const Column = ({ props, buildChild }: any) => {
  drew("Column");
  const layout = useContext(LayoutContext);
  if (!layout) return <div className="flex flex-col gap-2 min-w-0">{kids(props.children, buildChild)}</div>;
  // Only the root Column is laid out; one inside a part is drawn plainly.
  return <LayoutContext.Provider value={null}>{layout((name) => buildChild(name))}</LayoutContext.Provider>;
};

const TextField = ({ props, accessibilityRef, validationErrorsRef }: any) => {
  drew("TextField");
  const id = useId();
  const shared = {
    id,
    ref: accessibilityRef,
    value: props.value ?? "",
    placeholder: props.placeholder,
    onChange: (e: any) => props.setValue?.(e.target.value),
    className: "w-full px-2 py-1.5 rounded-md bg-[#010409] border border-[#30363d] text-xs text-[#c9d1d9] placeholder:text-[#8b949e]",
  };
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="text-[11px] text-[#8b949e]">
        {props.label}
      </label>
      {props.variant === "longText" ? <textarea rows={3} {...shared} className={`${shared.className} resize-y`} /> : <input {...shared} />}
      {props.isValid === false && (
        <p ref={validationErrorsRef} className="text-[11px] text-[#ff7b72]">
          {(props.validationErrors ?? []).join(" ")}
        </p>
      )}
    </div>
  );
};

const Button = ({ props, buildChild }: any) => {
  drew("Button");
  return (
    <button
      type="button"
      disabled={props.isValid === false}
      onClick={() => props.action?.()}
      className={`${props.variant === "primary" ? PRIMARY : SECONDARY} self-start [&_p]:my-0`}
    >
      {props.child && buildChild(props.child)}
    </button>
  );
};

const MINE: ReactCatalogComponent[] = [make(C.ColumnApi, Column), make(C.TextFieldApi, TextField), make(C.ButtonApi, Button)];
const mineNames = new Set(MINE.map((c) => c.name));
const components = [...QUAY.filter((c) => !mineNames.has(c.name)), ...MINE];

/** `openUrl` replaced, so nothing reaches `window.open`. */
const openUrl = C.createFunctionImplementation({ name: "openUrl", returnType: "void", schema: z.object({ url: z.string() }).strict() }, () => undefined);
const functions = [...[...C.basicCatalog.functions.keys()].filter((n: string) => n !== "openUrl"), openUrl];

export const catalog = C.basicCatalog.derive({ catalogId: CATALOG_ID, components, functions });

export const engine = (onAction: (action: any) => void) =>
  new C.MessageProcessor([catalog], onAction, { validationConfig: C.STRICT_VALIDATION, version: "1.0" });
export const errorBody = (e: unknown, surfaceId?: string): object => C.mapErrorToRendererMessage(e, { surfaceId, version: "1.0" }).error;
