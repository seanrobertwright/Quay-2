import { useId, type ChangeEvent, type RefCallback } from "react";
import { FieldNote } from "./FieldNote.tsx";
import { FIELD } from "./fieldStyles.ts";

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
  const id = useId();
  const noteId = useId();
  const field = {
    id,
    value,
    disabled,
    placeholder: placeholder || undefined,
    "aria-describedby": note ? noteId : undefined,
    onChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(e.target.value),
    className: FIELD,
  };
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-[11px] text-[#8b949e]">
        {label}
      </label>
      {rows === undefined ? (
        <input ref={ref} type={type} autoComplete={type === "password" ? "off" : undefined} {...field} />
      ) : (
        <textarea ref={ref} rows={rows} {...field} />
      )}
      <FieldNote id={noteId} note={note} />
    </div>
  );
};
