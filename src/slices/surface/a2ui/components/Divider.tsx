import { createComponentImplementation } from "@a2ui/react";
import { DividerApi } from "@a2ui/web_core/catalogs/basic/v1";
import { Rule } from "../../../parts/Rule.tsx";

/** A line between components. */
export const Divider = createComponentImplementation(DividerApi, ({ props, accessibilityRef }) => <Rule ref={accessibilityRef} axis={props.axis} />);
