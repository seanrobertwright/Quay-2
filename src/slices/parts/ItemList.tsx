import type { ReactNode, Ref } from "react";
import { ALIGN } from "./Stack.tsx";

const DIRECTIONS = { vertical: "flex-col", horizontal: "flex-row overflow-x-auto max-w-full" } as const;

interface ItemListProps {
  direction?: keyof typeof DIRECTIONS;
  align?: keyof typeof ALIGN;
  /** What is in the list, each with a key of its own. */
  items: readonly { key: string; node: ReactNode }[];
  ref?: Ref<HTMLUListElement>;
}

/** A list of things, one above the other, or beside each other in a box that scrolls. */
export const ItemList = ({ direction = "vertical", align = "stretch", items, ref }: ItemListProps) => (
  <ul ref={ref} className={`flex min-w-0 gap-2 ${DIRECTIONS[direction]} ${ALIGN[align]}`}>
    {items.map(({ key, node }) => (
      <li key={key} className={direction === "vertical" ? "min-w-0" : "max-w-full shrink-0"}>
        {node}
      </li>
    ))}
  </ul>
);
