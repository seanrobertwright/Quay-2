import { useId, type ReactNode } from "react";

/** One option of a choice, however it is drawn. */
export interface OptionProps {
  /** A radio is one choice of its group; a checkbox is ticked or not by itself. */
  kind: "radio" | "checkbox";
  /** The input's name, the same on every option of one group and on no other group's: a `useId()` of the group's. */
  group: string;
  label: string;
  /** A few more words, after the label or under it. */
  description?: string;
  /** A word or two that sets this option apart, such as whose pick it is. */
  mark?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}

/** The ids of an option's label, mark and description, which its input is tied to. */
export interface OptionIds {
  id: string;
  markId: string;
  descriptionId: string;
}

interface OptionInputProps {
  option: OptionProps;
  className: string;
  /** Draws the option's words, under their ids. */
  children: (ids: OptionIds) => ReactNode;
}

/** An option's native radio or checkbox, with the words that name and describe it beside it. */
export const OptionInput = ({ option: { kind, group, mark, description, checked, disabled = false, onChange }, className, children }: OptionInputProps) => {
  const id = useId();
  const descriptionId = useId();
  const markId = useId();
  const describedBy = [mark && markId, description && descriptionId].filter(Boolean).join(" ");
  return (
    <div className={`flex items-start border border-[#30363d] text-xs ${className}`}>
      <input
        id={id}
        type={kind}
        name={group}
        checked={checked}
        disabled={disabled}
        aria-describedby={describedBy || undefined}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-px shrink-0 accent-(--quay-accent)"
      />
      {children({ id, markId, descriptionId })}
    </div>
  );
};
