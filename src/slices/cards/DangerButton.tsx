import { BUTTON_SHAPE } from "../parts/buttonStyles.ts";

interface DangerButtonProps {
  onClick: () => void;
  /** What the button says. */
  children: string;
}

/** A card's red button, for a refusal or a choice that can't be undone. Cards only: the plain parts have no danger variant. */
export const DangerButton = ({ onClick, children }: DangerButtonProps) => (
  <button type="button" onClick={onClick} className={`${BUTTON_SHAPE} border-[#da3633] bg-[#da3633] text-white enabled:hover:bg-[#f85149]`}>
    {children}
  </button>
);
