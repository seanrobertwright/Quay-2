import { createComponentImplementation } from "@a2ui/react";
import { TextFieldApi } from "@a2ui/web_core/catalogs/basic/v1";
import { TextField as PlainTextField } from "../../../parts/TextField.tsx";

/** How high a long text's field is, in lines. */
const LONG_TEXT_ROWS = 3;

/** A labelled text field. One with checks has the message of the first that fails under it. */
export const TextField = createComponentImplementation(TextFieldApi, ({ props }) => (
  <PlainTextField
    label={props.label ?? ""}
    value={props.value ?? ""}
    rows={props.variant === "longText" ? LONG_TEXT_ROWS : undefined}
    note={props.validationErrors && (props.validationErrors[0] ?? "")}
    onChange={(text) => props.setValue(text)}
  />
));
