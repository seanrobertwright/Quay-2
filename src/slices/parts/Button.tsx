import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
import { BORDERLESS, PRIMARY, SECONDARY } from "./buttonStyles.ts";

const VARIANT = { primary: PRIMARY, secondary: SECONDARY, borderless: BORDERLESS } as const;

/** What tells that the pointer or the focus is on a button, and what else describes it. */
type Pointed = Pick<ButtonHTMLAttributes<HTMLButtonElement>, "aria-describedby" | "onMouseEnter" | "onMouseLeave" | "onFocus" | "onBlur">;

interface ButtonProps extends Pointed {
  /** Primary, the green one, is for the main action; the grey secondary for every other; borderless reads as a link. */
  variant?: keyof typeof VARIANT;
  disabled?: boolean;
  onClick: () => void;
  /** What the button says. */
  children: ReactNode;
  ref?: Ref<HTMLButtonElement>;
}

/** A long label wraps, in a button as high as it takes. */
const FITS = "h-auto! min-h-7 max-w-full wrap-anywhere";

/** A plain button. It submits no form. A destructive choice has no variant here; it is a card's alone. */
export const Button = ({ variant = "secondary", disabled = false, onClick, children, ref, ...pointed }: ButtonProps) => (
  <button ref={ref} type="button" disabled={disabled} onClick={onClick} className={`${VARIANT[variant]} ${FITS}`} {...pointed}>
    {children}
  </button>
);
