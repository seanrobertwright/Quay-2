import { z } from "zod";
import { createComponentImplementation } from "@a2ui/react";
import { ChoicePickerApi } from "@a2ui/web_core/catalogs/basic/v1";
import { Choice } from "../../../parts/Choice.tsx";
import { checkNote } from "../checkNote.ts";
import { textOf } from "../textOf.ts";

/** The standard's ChoicePicker, whose options gain a description and a recommended mark. */
const QuayChoicePickerApi = {
  ...ChoicePickerApi,
  schema: ChoicePickerApi.schema.extend({
    options: z.array(
      ChoicePickerApi.schema.shape.options.element
        .extend({
          description: z.string().describe("A second line under the label.").optional(),
          recommended: z.boolean().describe("True on the agent's pick, which Quay marks. Nothing is selected for the operator.").optional(),
        })
        .strict(),
    ),
  }),
};

/** One choice, or several. A picker with checks has the message of the first that fails under it. */
export const ChoicePicker = createComponentImplementation(QuayChoicePickerApi, ({ props, accessibilityRef }) => (
  <Choice
    ref={accessibilityRef}
    label={textOf(props.label)}
    many={props.variant === "multipleSelection"}
    chips={props.displayStyle === "chips"}
    filterable={props.filterable === true}
    options={props.options.map(({ label, value, description, recommended }) => ({ label: textOf(label), value, description, mark: recommended ? "agent's pick" : undefined }))}
    chosen={Array.isArray(props.value) ? props.value : []}
    note={checkNote(props)}
    onChoose={(chosen) => props.setValue(chosen)}
  />
));
