import { useId, type Ref } from "react";
import { FieldNote } from "./FieldNote.tsx";

interface CheckBoxProps {
  /** The label on screen, which also names the box for a screen reader. */
  label: string;
  checked: boolean;
  /** A line under the box, which also describes it for a screen reader. An empty one keeps its room. */
  note?: string;
  onChange: (checked: boolean) => void;
  ref?: Ref<HTMLInputElement>;
}

/** A labelled checkbox. It holds no state of its own: `checked` is what it shows. */
export const CheckBox = ({ label, checked, note, onChange, ref }: CheckBoxProps) => {
  const id = useId();
  const noteId = useId();
  return (
    <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-x-2 text-xs">
      <input
        ref={ref}
        id={id}
        type="checkbox"
        checked={checked}
        aria-describedby={note ? noteId : undefined}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-px shrink-0 accent-(--quay-accent)"
      />
      <label htmlFor={id} className="min-w-0 wrap-anywhere whitespace-pre-wrap text-white">
        {label}
      </label>
      {note !== undefined && (
        <div className="col-start-2">
          <FieldNote id={noteId} note={note} />
        </div>
      )}
    </div>
  );
};
