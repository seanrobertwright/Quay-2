// What a component holds, drawn and keyed. The engine's own key of a component has the data path of the
// row it is in, so a row that moved would lose what the operator did in it.
import { cloneElement, Fragment, isValidElement, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { useA2uiSurface } from "@a2ui/react";
import { usePaged } from "../../parts/usePaged.tsx";
import { useRowKeys } from "./rowKeys.ts";

/** Draws the component of an id, at a data path when it is a row of a template. */
export type BuildChild = (id: string, basePath?: string) => ReactNode;

/** A child as the engine resolves it: an id, or a row of a template with the path its data is at. */
type ChildRef = string | { id: string; basePath: string };

interface Child {
  key: string;
  node: ReactNode;
}

const NONE: readonly ChildRef[] = [];

/** The key of what shows more. No child's is like it: an id has no bracket, and a row's has a number too. */
const MORE = '["more"]';

/** `node`, with `key` in place of the engine's own. */
const keyedAs = (key: string, node: ReactNode): ReactNode => (isValidElement(node) ? cloneElement(node, { key }) : node);

/** The one child a component draws: `id`, as the engine resolves it. `told` is what tells it from another, such as the id its agent wrote. */
export const onlyChild = (id: string | undefined, told: unknown, buildChild: BuildChild): ReactNode =>
  id ? keyedAs(JSON.stringify([told]), buildChild(id)) : null;

/** What each of `refs` is of, as text: the data of a template's row, followed as it changes, or the id of any other child. */
function useRows(refs: readonly ChildRef[]): readonly string[] {
  const data = useA2uiSurface()?.dataModel;
  const store = useMemo(() => {
    const read = () => refs.map((ref) => (typeof ref === "string" ? ref : JSON.stringify([data?.get<unknown>(ref.basePath)])));
    let rows = read();
    const row = refs.find((ref) => typeof ref !== "string");
    const subscribe = (changed: () => void) => {
      // The engine draws a container again when its rows are more or fewer, and not when they are in another order
      const refresh = () => {
        const next = read();
        if (next.every((text, i) => text === rows[i])) return;
        rows = next;
        changed();
      };
      const subscription = row && data?.subscribe(row.basePath.slice(0, row.basePath.lastIndexOf("/")) || "/", refresh);
      refresh();
      return () => subscription?.unsubscribe();
    };
    return { subscribe, get: () => rows };
  }, [data, refs]);
  return useSyncExternalStore(store.subscribe, store.get);
}

/**
 * The children that `children`, a container's property once it is resolved, names. A template's are keyed
 * by the data each is of. Of many, the first are drawn, and the last child is what shows more.
 */
export function useChildren(children: unknown, buildChild: BuildChild): Child[] {
  const { shown, more } = usePaged<ChildRef>(Array.isArray(children) ? children : NONE);
  const keys = useRowKeys(useRows(shown));
  const drawn = shown.map((ref, i) => {
    const key = keys[i];
    return { key, node: keyedAs(key, typeof ref === "string" ? buildChild(ref) : buildChild(ref.id, ref.basePath)) };
  });
  return more ? [...drawn, { key: MORE, node: <Fragment key={MORE}>{more}</Fragment> }] : drawn;
}
