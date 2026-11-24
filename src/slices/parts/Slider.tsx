import { useId, type Ref } from "react";
import { FieldNote } from "./FieldNote.tsx";

interface SliderProps {
  /** The label on screen, which also names the slider for a screen reader. */
  label: string;
  min: number;
  max: number;
  step: number;
  /** What it shows, which is drawn as the nearest it can be. */
  value: number;
  /** A line under the slider, which also describes it for a screen reader. An empty one keeps its room. */
  note?: string;
  onChange: (value: number) => void;
  ref?: Ref<HTMLInputElement>;
}

/** A labelled slider with its value in words. It holds no value of its own: `value` is what it shows. */
export const Slider = ({ label, min, max, step, value, note, onChange, ref }: SliderProps) => {
  const id = useId();
  const noteId = useId();
  return (
    <div className="min-w-0 space-y-1">
      <div className="flex min-w-0 gap-2 text-[11px]">
        <label htmlFor={id} className="min-w-0 flex-1 wrap-anywhere text-[#8b949e]">
          {label}
        </label>
        <output htmlFor={id} className="shrink-0 font-mono text-white">
          {/* Without the digits that only come of counting in steps */}
          {Number(value.toPrecision(12))}
        </output>
      </div>
      <input
        ref={ref}
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-describedby={note ? noteId : undefined}
        onChange={(e) => onChange(e.target.valueAsNumber)}
        className="block w-full accent-(--quay-accent)"
      />
      <FieldNote id={noteId} note={note} />
    </div>
  );
};
