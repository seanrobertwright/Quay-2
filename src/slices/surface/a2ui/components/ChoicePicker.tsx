import { useId } from "react";
import { z } from "zod";
import { createComponentImplementation } from "@a2ui/react";
import { ChoicePickerApi } from "@a2ui/web_core/catalogs/basic/v1";
import { OptionRow } from "../../../parts/OptionRow.tsx";

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

interface ChoicesProps {
  label: string;
  many: boolean;
  options: readonly { label?: string; value: string; description?: string; recommended?: boolean }[];
  chosen: readonly string[];
  choose: (chosen: string[]) => void;
}

const Choices = ({ label, many, options, chosen, choose }: ChoicesProps) => {
  const group = useId();
  const change = (value: string, checked: boolean) => {
    if (!many) choose([value]);
    else choose(checked ? [...chosen, value] : chosen.filter((other) => other !== value));
  };
  return (
    <fieldset className="flex min-w-0 flex-col gap-1.5">
      <legend className="sr-only">{label}</legend>
      {options.map((option) => (
        <OptionRow
          key={option.value}
          kind={many ? "checkbox" : "radio"}
          group={group}
          label={option.label ?? ""}
          description={option.description}
          mark={option.recommended ? "agent's pick" : undefined}
          checked={chosen.includes(option.value)}
          onChange={(checked) => change(option.value, checked)}
        />
      ))}
    </fieldset>
  );
};

/** One choice, or several, as native radios or checkboxes. */
export const ChoicePicker = createComponentImplementation(QuayChoicePickerApi, ({ props }) => (
  <Choices
    label={props.label ?? ""}
    many={props.variant === "multipleSelection"}
    options={props.options}
    chosen={props.value ?? []}
    choose={(chosen) => props.setValue(chosen)}
  />
));
