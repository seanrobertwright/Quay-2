import { createComponentImplementation } from "@a2ui/react";
import { TextFieldApi } from "@a2ui/web_core/catalogs/basic/v1";
import { TextField as PlainTextField } from "../../../parts/TextField.tsx";
import { textOf } from "../textOf.ts";

/** How high a long text's field is, in lines. */
const LONG_TEXT_ROWS = 3;

/** A labelled text field. */
export const TextField = createComponentImplementation(TextFieldApi, ({ props }) => (
  <PlainTextField
    label={textOf(props.label)}
    value={textOf(props.value)}
    rows={props.variant === "longText" ? LONG_TEXT_ROWS : undefined}
    onChange={(text) => props.setValue(text)}
  />
));
