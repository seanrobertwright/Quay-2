import { useContext } from "react";
import { createComponentImplementation } from "@a2ui/react";
import { ColumnApi } from "@a2ui/web_core/catalogs/basic/v1";
import { LayoutContext } from "../../layout.ts";
import { StackView, type StackViewProps } from "./StackView.tsx";

const ColumnView = (props: StackViewProps) => {
  const layout = useContext(LayoutContext);
  if (!layout) return <StackView {...props} />;
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
  <ColumnView ids={props.children} buildChild={buildChild} look={{ direction: "column", justify: props.justify, align: props.align }} />
));
