import { createComponentImplementation } from "@a2ui/react";
import { SliderApi } from "@a2ui/web_core/catalogs/basic/v1";
import { Slider as PlainSlider } from "../../../parts/Slider.tsx";
import { checkNote } from "../checkNote.ts";
import { textOf } from "../textOf.ts";

/** A range this wide or wider has a stop at each whole number; a narrower one has as many stops as a percentage. */
const WHOLE_NUMBERS_FROM = 10;

/** How far apart a slider's stops are: `steps` of them, or near enough to none when it asks for no stops. */
function stepOf(span: number, steps: number | undefined): number {
  if (span <= 0) return 1;
  if (steps !== undefined) return span / steps;
  return span >= WHOLE_NUMBERS_FROM ? 1 : span / 100;
}

/** A labelled slider. One with checks has the message of the first that fails under it. */
export const Slider = createComponentImplementation(SliderApi, ({ props, accessibilityRef }) => {
  const { min = 0, max } = props;
  const value: unknown = props.value;
  return (
    <PlainSlider
      ref={accessibilityRef}
      label={textOf(props.label) || "Value"}
      min={min}
      max={max}
      step={stepOf(max - min, props.steps)}
      value={typeof value === "number" && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : min}
      note={checkNote(props)}
      onChange={(now) => props.setValue(now)}
    />
  );
});
