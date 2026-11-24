import { useId, type ChangeEvent } from "react";

interface TextFieldProps {
  /** The label on screen, which also names the field for a screen reader. */
  label: string;
  value: string;
  /** Given, the field takes several lines and is this many high; otherwise it takes one. */
  rows?: number;
  disabled?: boolean;
  /** A line under the field, which also describes it for a screen reader. An empty one keeps its room. */
  note?: string;
  onChange: (text: string) => void;
}

const FIELD =
  "w-full rounded-md border border-[#30363d] bg-[#0d1117] px-2 py-1.5 text-xs text-white focus:border-(--quay-accent) focus:outline-hidden disabled:opacity-50";

/** A labelled text field. It holds no text of its own: `value` is what it shows. */
export const TextField = ({ label, value, rows, disabled = false, note, onChange }: TextFieldProps) => {
  const id = useId();
  const noteId = useId();
  const field = {
    id,
    value,
    disabled,
    "aria-describedby": note ? noteId : undefined,
    onChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(e.target.value),
    className: FIELD,
  };
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-[11px] text-[#8b949e]">
        {label}
      </label>
      {rows === undefined ? <input type="text" {...field} /> : <textarea rows={rows} {...field} />}
      {note !== undefined && (
        <p id={noteId} className="min-h-4 text-[11px] leading-4 wrap-anywhere text-[#8b949e]">
          {note}
        </p>
      )}
    </div>
  );
};
