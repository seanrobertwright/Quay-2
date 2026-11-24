import type { ReactNode } from "react";

const DIRECTIONS = { row: "flex-row flex-wrap", column: "flex-col" } as const;

const JUSTIFY = {
  start: "justify-start",
  center: "justify-center",
  end: "justify-end",
  spaceBetween: "justify-between",
  spaceAround: "justify-around",
  spaceEvenly: "justify-evenly",
  // What fills the room is what is inside, which is drawn in a box of its own that has no look
  stretch: "justify-stretch [&>*>*]:grow",
} as const;

/** How what is in a stack or a list lies across it, as classes. */
export const ALIGN = { start: "items-start", center: "items-center", end: "items-end", stretch: "items-stretch" } as const;

interface StackProps {
  /** A row wraps where there is no room. */
  direction: keyof typeof DIRECTIONS;
  justify?: keyof typeof JUSTIFY;
  align?: keyof typeof ALIGN;
  children: ReactNode;
}

/** Things beside each other, or one above the other. */
export const Stack = ({ direction, justify = "start", align = "stretch", children }: StackProps) => (
  <div className={`flex min-w-0 gap-2 ${DIRECTIONS[direction]} ${JUSTIFY[justify]} ${ALIGN[align]}`}>{children}</div>
);
