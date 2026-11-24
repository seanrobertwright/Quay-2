import { Stack } from "../../../parts/Stack.tsx";
import { useChildren, type BuildChild } from "../children.tsx";

export interface StackViewProps {
  ids: unknown;
  buildChild: BuildChild;
  look: Pick<Parameters<typeof Stack>[0], "direction" | "justify" | "align">;
}

/** The components a Row or a Column holds. */
export const StackView = ({ ids, buildChild, look }: StackViewProps) => (
  <Stack {...look}>{useChildren(ids, buildChild).map(({ node }) => node)}</Stack>
);
