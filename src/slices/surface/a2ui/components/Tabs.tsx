import { useState, type Ref } from "react";
import { createComponentImplementation } from "@a2ui/react";
import { TabsApi } from "@a2ui/web_core/catalogs/basic/v1";
import { Segments } from "../../../parts/Segments.tsx";
import { textOf } from "../textOf.ts";
import type { BuildChild } from "../useChildren.ts";

interface TabsViewProps {
  tabs: readonly { title?: unknown; child?: string }[];
  buildChild: BuildChild;
  groupRef: Ref<HTMLDivElement> | undefined;
}

const TabsView = ({ tabs, buildChild, groupRef }: TabsViewProps) => {
  const [picked, setPicked] = useState(0);
  const child = tabs[picked]?.child;
  return (
    <div className="flex min-w-0 flex-col gap-2.5">
      <Segments ref={groupRef} titles={tabs.map(({ title }) => textOf(title))} pressed={picked} onPress={setPicked} />
      {child && buildChild(child)}
    </div>
  );
};

/** Components of which one is drawn at a time. What is put in one is kept while another is drawn. */
export const Tabs = createComponentImplementation(TabsApi, ({ props, buildChild, accessibilityRef }) => (
  <TabsView tabs={Array.isArray(props.tabs) ? props.tabs : []} buildChild={buildChild} groupRef={accessibilityRef} />
));
