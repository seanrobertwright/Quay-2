import { DANGER } from "./buttonStyles.ts";

interface DangerButtonProps {
  onClick: () => void;
  /** What the button says. */
  children: string;
}

/** A card's red button, for a refusal or a choice that can't be undone. Cards only: the plain parts have no danger variant. */
export const DangerButton = ({ onClick, children }: DangerButtonProps) => (
  <button type="button" onClick={onClick} className={DANGER}>
    {children}
  </button>
);
