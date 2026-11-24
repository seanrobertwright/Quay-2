import { useContext } from "react";
import { createComponentImplementation } from "@a2ui/react";
import { ColumnApi } from "@a2ui/web_core/catalogs/basic/v1";
import { Stack } from "../../../parts/Stack.tsx";
import { LayoutContext } from "../../layout.ts";
import { useChildren, type BuildChild } from "../useChildren.ts";

interface ColumnViewProps {
  ids: unknown;
  buildChild: BuildChild;
  look: Pick<Parameters<typeof Stack>[0], "justify" | "align">;
}

const PlainColumn = ({ ids, buildChild, look }: ColumnViewProps) => {
  const children = useChildren(ids, buildChild);
  return (
    <Stack direction="column" {...look}>
      {children.map(({ node }) => node)}
    </Stack>
  );
};

const ColumnView = (props: ColumnViewProps) => {
  const layout = useContext(LayoutContext);
  if (!layout) return <PlainColumn {...props} />;
  const { Layout, components, data } = layout;
  // Only the root is laid out by the frame; a Column inside one of its parts is drawn plainly.
  return (
    <LayoutContext.Provider value={null}>
      <Layout part={(id) => props.buildChild(id)} components={components} data={data} />
    </LayoutContext.Provider>
  );
};

/** A column, or, at the root of a typed surface, the frame's own layout of its named parts. */
export const Column = createComponentImplementation(ColumnApi, ({ props, buildChild }) => (
  <ColumnView ids={props.children} buildChild={buildChild} look={{ justify: props.justify, align: props.align }} />
));
