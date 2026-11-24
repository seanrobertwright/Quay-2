import type { ChangeEvent, RefCallback } from "react";
import { FIELD } from "./fieldStyles.ts";
import { LabelledField } from "./LabelledField.tsx";

interface TextFieldProps {
  /** The label on screen, which also names the field for a screen reader. */
  label: string;
  value: string;
  /** Given, the field takes several lines and is this many high; otherwise it takes one. */
  rows?: number;
  /** What one line takes. A password is hidden as it is typed. */
  type?: "text" | "number" | "password";
  /** What an empty field says, in place of its value. */
  placeholder?: string;
  disabled?: boolean;
  /** A line under the field, which also describes it for a screen reader. An empty one keeps its room. */
  note?: string;
  onChange: (text: string) => void;
  ref?: RefCallback<HTMLInputElement | HTMLTextAreaElement>;
}

/** A labelled text field. It holds no text of its own: `value` is what it shows. */
export const TextField = ({ label, value, rows, type = "text", placeholder, disabled = false, note, onChange, ref }: TextFieldProps) => {
  const field = {
    value,
    disabled,
    placeholder: placeholder || undefined,
    onChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(e.target.value),
    className: FIELD,
  };
  return (
    <LabelledField label={label} note={note}>
      {(ids) =>
        rows === undefined ? (
          <input ref={ref} type={type} autoComplete={type === "password" ? "off" : undefined} {...ids} {...field} />
        ) : (
          <textarea ref={ref} rows={rows} {...ids} {...field} />
        )
      }
    </LabelledField>
  );
};
