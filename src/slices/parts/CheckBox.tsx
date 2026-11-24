import { useId } from "react";

interface CheckBoxProps {
  /** The label on screen, which also names the box for a screen reader. */
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}

/** A labelled checkbox. It holds no state of its own: `checked` is what it shows. */
export const CheckBox = ({ label, checked, disabled = false, onChange }: CheckBoxProps) => {
  const id = useId();
  return (
    <div className="flex min-w-0 items-start gap-2 text-xs">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-px shrink-0 accent-(--quay-accent)"
      />
      <label htmlFor={id} className="min-w-0 wrap-anywhere whitespace-pre-wrap text-white">
        {label}
      </label>
    </div>
  );
};
