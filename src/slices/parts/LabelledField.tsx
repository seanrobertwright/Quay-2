import { useId, type ReactNode } from "react";
import { FieldNote } from "./FieldNote.tsx";

/** What ties a native input to its label and note. */
export interface FieldIds {
  id: string;
  "aria-describedby": string | undefined;
}

interface LabelledFieldProps {
  /** The label on screen, which also names the field for a screen reader. */
  label: string;
  /** A line under the field, which also describes it for a screen reader. An empty one keeps its room. */
  note: string | undefined;
  /** Draws the native input, which takes the ids. */
  children: (ids: FieldIds) => ReactNode;
}

/** A field between its label and its note. */
export const LabelledField = ({ label, note, children }: LabelledFieldProps) => {
  const id = useId();
  const noteId = useId();
  return (
    <div className="min-w-0 space-y-1">
      <label htmlFor={id} className="block text-[11px] wrap-anywhere text-[#8b949e]">
        {label}
      </label>
      {children({ id, "aria-describedby": note ? noteId : undefined })}
      <FieldNote id={noteId} note={note} />
    </div>
  );
};
