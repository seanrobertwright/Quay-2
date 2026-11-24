import { createComponentImplementation } from "@a2ui/react";
import { CheckBoxApi } from "@a2ui/web_core/catalogs/basic/v1";
import { CheckBox as PlainCheckBox } from "../../../parts/CheckBox.tsx";
import { checkNote } from "../checkNote.ts";
import { textOf } from "../textOf.ts";

/** A labelled checkbox. One with checks has the message of the first that fails under it. */
export const CheckBox = createComponentImplementation(CheckBoxApi, ({ props, accessibilityRef }) => (
  <PlainCheckBox ref={accessibilityRef} label={textOf(props.label)} checked={props.value === true} note={checkNote(props)} onChange={(checked) => props.setValue(checked)} />
));
