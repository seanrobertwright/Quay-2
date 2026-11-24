import { useState, type Ref } from "react";
import { createComponentImplementation } from "@a2ui/react";
import { TabsApi } from "@a2ui/web_core/catalogs/basic/v1";
import { Segments } from "../../../parts/Segments.tsx";
import { isObject } from "../../json.ts";
import { textOf } from "../textOf.ts";
import { onlyChild, type BuildChild } from "../children.tsx";

interface TabsViewProps {
  tabs: readonly { title?: unknown; child?: string }[];
  /** The tabs as their agent wrote them, whose children have the ids it gave them. */
  written: unknown;
  buildChild: BuildChild;
  groupRef: Ref<HTMLDivElement> | undefined;
}

const TabsView = ({ tabs, written, buildChild, groupRef }: TabsViewProps) => {
  const [last, setPicked] = useState(0);
  // An update can take the last pick away
  const picked = last < tabs.length ? last : 0;
  const tab: unknown = Array.isArray(written) ? written[picked] : undefined;
  return (
    <div className="flex min-w-0 flex-col gap-2.5">
      <Segments ref={groupRef} titles={tabs.map(({ title }) => textOf(title))} pressed={picked} onPress={setPicked} />
      {onlyChild(tabs[picked]?.child, [picked, isObject(tab) ? tab.child : null], buildChild)}
    </div>
  );
};

/** Components of which one is drawn at a time. What is put in one is kept while another is drawn. */
export const Tabs = createComponentImplementation(TabsApi, ({ props, buildChild, context, accessibilityRef }) => (
  <TabsView tabs={Array.isArray(props.tabs) ? props.tabs : []} written={context.componentModel.properties.tabs} buildChild={buildChild} groupRef={accessibilityRef} />
));
