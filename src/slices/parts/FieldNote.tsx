interface FieldNoteProps {
  /** What the field's `aria-describedby` names. */
  id: string;
  /** Left out, there is no line; an empty one keeps its room. */
  note: string | undefined;
}

/** A line under a field, such as what is wrong with what is in it. */
export const FieldNote = ({ id, note }: FieldNoteProps) =>
  note === undefined ? null : (
    <p id={id} className="min-h-4 text-[11px] leading-4 wrap-anywhere text-[#8b949e]">
      {note}
    </p>
  );
