import { useEffect, useState } from "react";
import { SECONDARY } from "../parts/buttonStyles.ts";
import { DANGER } from "./buttonStyles.ts";

/** How long a press-twice button stays armed, in ms. */
const ARMED_MS = 4000;

interface PressTwiceProps {
  label: string;
  armedLabel: string;
  disabled: boolean;
  onConfirm: () => void;
}

/**
 * A card's button that acts only on its second press, for a choice that can't be undone. Armed, it
 * is red and is still the same element, so it keeps keyboard focus. Cards only, as the red is.
 */
export const PressTwice = ({ label, armedLabel, disabled, onConfirm }: PressTwiceProps) => {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(false), ARMED_MS);
    return () => window.clearTimeout(timer);
  }, [armed]);
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else {
          setArmed(true);
        }
      }}
      className={armed ? DANGER : SECONDARY}
    >
      {armed ? armedLabel : label}
    </button>
  );
};
