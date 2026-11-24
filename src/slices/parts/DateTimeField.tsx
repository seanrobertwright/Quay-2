import type { Ref } from "react";
import { FIELD } from "./fieldStyles.ts";
import { LabelledField } from "./LabelledField.tsx";

interface DateTimeFieldProps {
  /** The label on screen, which also names the field for a screen reader. */
  label: string;
  type: "date" | "time" | "datetime-local";
  /** What it shows, and the least and the most it takes, each as a native input of its type has it. Empty for none. */
  value: string;
  min?: string;
  max?: string;
  /** A line under the field, which also describes it for a screen reader. An empty one keeps its room. */
  note?: string;
  onChange: (value: string) => void;
  ref?: Ref<HTMLInputElement>;
}

/** A labelled field for a date, a time or both. It holds nothing of its own: `value` is what it shows. */
export const DateTimeField = ({ label, type, value, min, max, note, onChange, ref }: DateTimeFieldProps) => (
  <LabelledField label={label} note={note}>
    {(ids) => (
      <input
        ref={ref}
        {...ids}
        type={type}
        value={value}
        min={min || undefined}
        max={max || undefined}
        onChange={(e) => onChange(e.target.value)}
        className={`${FIELD} max-w-64 scheme-dark`}
      />
    )}
  </LabelledField>
);
