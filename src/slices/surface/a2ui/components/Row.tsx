import { createComponentImplementation } from "@a2ui/react";
import { RowApi } from "@a2ui/web_core/catalogs/basic/v1";
import { Stack } from "../../../parts/Stack.tsx";
import { useChildren, type BuildChild } from "../useChildren.ts";

interface RowViewProps {
  ids: unknown;
  buildChild: BuildChild;
  look: Pick<Parameters<typeof Stack>[0], "justify" | "align">;
}

const RowView = ({ ids, buildChild, look }: RowViewProps) => {
  const children = useChildren(ids, buildChild);
  return (
    <Stack direction="row" {...look}>
      {children.map(({ node }) => node)}
    </Stack>
  );
};

/** Components beside each other. */
export const Row = createComponentImplementation(RowApi, ({ props, buildChild }) => (
  <RowView ids={props.children} buildChild={buildChild} look={{ justify: props.justify, align: props.align }} />
));
