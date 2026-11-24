import type { ReactNode } from "react";
import { PRIMARY, SECONDARY } from "./buttonStyles.ts";

const VARIANT = { primary: PRIMARY, secondary: SECONDARY } as const;

interface ButtonProps {
  /** Primary, the green one, is for the main action; the grey secondary for every other. */
  variant?: keyof typeof VARIANT;
  disabled?: boolean;
  onClick: () => void;
  /** What the button says. */
  children: ReactNode;
}

/** A plain button. It submits no form. A destructive choice has no variant here; it is a card's alone. */
export const Button = ({ variant = "secondary", disabled = false, onClick, children }: ButtonProps) => (
  <button type="button" disabled={disabled} onClick={onClick} className={VARIANT[variant]}>
    {children}
  </button>
);
