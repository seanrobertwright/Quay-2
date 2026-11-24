import { createComponentImplementation } from "@a2ui/react";
import { CardApi } from "@a2ui/web_core/catalogs/basic/v1";
import { Panel } from "../../../parts/Panel.tsx";
import { onlyChild } from "../children.tsx";

/** A box around a component. Quay's own cards are another thing, and have the Quay mark. */
export const Card = createComponentImplementation(CardApi, ({ props, buildChild, context }) => (
  <Panel>{onlyChild(props.child, context.componentModel.properties.child, buildChild)}</Panel>
));
