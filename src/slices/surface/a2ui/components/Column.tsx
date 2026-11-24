import { useContext, type ReactNode } from "react";
import { createComponentImplementation } from "@a2ui/react";
import { ColumnApi } from "@a2ui/web_core/catalogs/basic/v1";
import { LayoutContext } from "../../layout.ts";

interface ColumnViewProps {
  children: ReactNode;
  /** Draws the component of an id. */
  part: (id: string) => ReactNode;
}

const ColumnView = ({ children, part }: ColumnViewProps) => {
  const layout = useContext(LayoutContext);
  if (!layout) return <div className="flex min-w-0 flex-col gap-2">{children}</div>;
  const { Layout, components, data } = layout;
  // Only the root is laid out by the frame; a Column inside one of its parts is drawn plainly.
  return (
    <LayoutContext.Provider value={null}>
      <Layout part={part} components={components} data={data} />
    </LayoutContext.Provider>
  );
};

/** A column, or, at the root of a typed surface, the frame's own layout of its named parts. */
export const Column = createComponentImplementation(ColumnApi, ({ props, buildChild }) => {
  const children = Array.isArray(props.children) ? props.children : [];
  return (
    <ColumnView part={(id) => buildChild(id)}>
      {children.map((child) => (typeof child === "string" ? buildChild(child) : buildChild(child.id, child.basePath)))}
    </ColumnView>
  );
});
