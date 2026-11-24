import type { Ref } from "react";
import { createComponentImplementation } from "@a2ui/react";
import { ListApi } from "@a2ui/web_core/catalogs/basic/v1";
import { ItemList } from "../../../parts/ItemList.tsx";
import { useChildren, type BuildChild } from "../useChildren.ts";

interface ListViewProps {
  ids: unknown;
  buildChild: BuildChild;
  look: Pick<Parameters<typeof ItemList>[0], "direction" | "align">;
  listRef: Ref<HTMLUListElement> | undefined;
}

const ListView = ({ ids, buildChild, look, listRef }: ListViewProps) => <ItemList ref={listRef} items={useChildren(ids, buildChild)} {...look} />;

/** A list of components. */
export const List = createComponentImplementation(ListApi, ({ props, buildChild, accessibilityRef }) => (
  <ListView ids={props.children} buildChild={buildChild} look={{ direction: props.direction, align: props.align }} listRef={accessibilityRef} />
));
