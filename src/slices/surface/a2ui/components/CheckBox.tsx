import { createComponentImplementation } from "@a2ui/react";
import { CheckBoxApi } from "@a2ui/web_core/catalogs/basic/v1";
import { CheckBox as PlainCheckBox } from "../../../parts/CheckBox.tsx";

/** A labelled checkbox. */
export const CheckBox = createComponentImplementation(CheckBoxApi, ({ props }) => (
  <PlainCheckBox label={props.label ?? ""} checked={props.value === true} onChange={(checked) => props.setValue(checked)} />
));
