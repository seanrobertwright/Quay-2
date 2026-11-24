// What a container component holds, drawn and keyed.
import { cloneElement, isValidElement, type ReactNode } from "react";
import { useA2uiSurface } from "@a2ui/react";
import { useRowKeys } from "./rowKeys.ts";

/** Draws the component of an id, at a data path when it is a row of a template. */
export type BuildChild = (id: string, basePath?: string) => ReactNode;

/** A child as the engine resolves it: an id, or a row of a template with the path its data is at. */
type ChildRef = string | { id: string; basePath: string };

interface Child {
  key: string;
  node: ReactNode;
}

/** The children that `children`, a container's property once it is resolved, names. A template's are keyed by the data each is of. */
export function useChildren(children: unknown, buildChild: BuildChild): Child[] {
  const data = useA2uiSurface()?.dataModel;
  const refs: readonly ChildRef[] = Array.isArray(children) ? children : [];
  const keys = useRowKeys(refs.map((ref) => (typeof ref === "string" ? ref : JSON.stringify([data?.get<unknown>(ref.basePath)]))));
  return refs.map((ref, i) => {
    const key = keys[i];
    const node = typeof ref === "string" ? buildChild(ref) : buildChild(ref.id, ref.basePath);
    // The engine's own key of a row is the path it is at, which ends in its index
    return { key, node: isValidElement(node) ? cloneElement(node, { key }) : node };
  });
}
