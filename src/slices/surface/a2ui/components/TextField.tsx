import { createComponentImplementation } from "@a2ui/react";
import { TextFieldApi } from "@a2ui/web_core/catalogs/basic/v1";
import { TextField as PlainTextField } from "../../../parts/TextField.tsx";
import { checkNote } from "../checkNote.ts";
import { textOf } from "../textOf.ts";

/** How high a long text's field is, in lines. */
const LONG_TEXT_ROWS = 3;

const TYPES = { shortText: "text", longText: "text", number: "number", obscured: "password" } as const;

/** A labelled text field. One with checks has the message of the first that fails under it. */
export const TextField = createComponentImplementation(TextFieldApi, ({ props, accessibilityRef }) => (
  <PlainTextField
    ref={accessibilityRef}
    label={textOf(props.label)}
    value={textOf(props.value)}
    type={TYPES[props.variant ?? "shortText"]}
    placeholder={textOf(props.placeholder)}
    rows={props.variant === "longText" ? LONG_TEXT_ROWS : undefined}
    note={checkNote(props)}
    onChange={(text) => props.setValue(text)}
  />
));
