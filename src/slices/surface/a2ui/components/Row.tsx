import { createComponentImplementation } from "@a2ui/react";
import { RowApi } from "@a2ui/web_core/catalogs/basic/v1";
import { StackView } from "./StackView.tsx";

/** Components beside each other. */
export const Row = createComponentImplementation(RowApi, ({ props, buildChild }) => (
  <StackView ids={props.children} buildChild={buildChild} look={{ direction: "row", justify: props.justify, align: props.align }} />
));
