import { useId, type Ref } from "react";
import { FieldNote } from "./FieldNote.tsx";
import { FIELD } from "./fieldStyles.ts";

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
export const DateTimeField = ({ label, type, value, min, max, note, onChange, ref }: DateTimeFieldProps) => {
  const id = useId();
  const noteId = useId();
  return (
    <div className="min-w-0 space-y-1">
      <label htmlFor={id} className="block text-[11px] wrap-anywhere text-[#8b949e]">
        {label}
      </label>
      <input
        ref={ref}
        id={id}
        type={type}
        value={value}
        min={min || undefined}
        max={max || undefined}
        aria-describedby={note ? noteId : undefined}
        onChange={(e) => onChange(e.target.value)}
        className={`${FIELD} max-w-64 scheme-dark`}
      />
      <FieldNote id={noteId} note={note} />
    </div>
  );
};
