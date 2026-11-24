import { useId } from "react";

interface OptionRowProps {
  /** A radio is one choice of its group; a checkbox is ticked or not by itself. */
  kind: "radio" | "checkbox";
  /** The input's name, the same on every row of one group and on no other group's: a `useId()` of the group's. */
  group: string;
  label: string;
  /** A second line under the label. */
  description?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}

/** One option of a choice: a native radio or checkbox with its label and description. */
export const OptionRow = ({ kind, group, label, description, checked, disabled = false, onChange }: OptionRowProps) => {
  const id = useId();
  const descriptionId = useId();
  return (
    <div className="flex items-start gap-2 rounded-md border border-[#30363d] p-2 text-xs">
      <input
        id={id}
        type={kind}
        name={group}
        checked={checked}
        disabled={disabled}
        aria-describedby={description ? descriptionId : undefined}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-px shrink-0 accent-(--quay-accent)"
      />
      <div className="min-w-0 wrap-anywhere">
        <label htmlFor={id} className="block font-semibold text-white">
          {label}
        </label>
        {description && (
          <p id={descriptionId} className="text-[11px] text-[#8b949e]">
            {description}
          </p>
        )}
      </div>
    </div>
  );
};
