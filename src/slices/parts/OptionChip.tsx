import { useId } from "react";

interface OptionChipProps {
  /** A radio is one choice of its group; a checkbox is ticked or not by itself. */
  kind: "radio" | "checkbox";
  /** The input's name, the same on every chip of one group and on no other group's: a `useId()` of the group's. */
  group: string;
  label: string;
  /** A few words after the label. */
  description?: string;
  /** A word or two that sets this option apart, such as whose pick it is. */
  mark?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

/** One option of a choice, as small as its words: a native radio or checkbox with its label, mark and description. */
export const OptionChip = ({ kind, group, label, description, mark, checked, onChange }: OptionChipProps) => {
  const id = useId();
  const descriptionId = useId();
  const markId = useId();
  const describedBy = [mark && markId, description && descriptionId].filter(Boolean).join(" ");
  return (
    <div className="flex max-w-full min-w-0 items-start gap-1.5 rounded-2xl border border-[#30363d] px-2.5 py-1 text-xs">
      <input
        id={id}
        type={kind}
        name={group}
        checked={checked}
        aria-describedby={describedBy || undefined}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-px shrink-0 accent-(--quay-accent)"
      />
      <div className="min-w-0 wrap-anywhere">
        <label htmlFor={id} className="text-white">
          {label}
        </label>
        {mark && (
          <span id={markId} className="ml-1.5 rounded-full border border-[#a371f7]/50 px-1.5 text-[10px] text-[#d2a8ff]">
            {mark}
          </span>
        )}
        {description && (
          <span id={descriptionId} className="ml-1.5 text-[11px] text-[#8b949e]">
            {description}
          </span>
        )}
      </div>
    </div>
  );
};
