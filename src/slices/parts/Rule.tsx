import type { Ref } from "react";

const AXES = {
  horizontal: "w-full border-t",
  vertical: "min-h-4 self-stretch border-l",
} as const;

interface RuleProps {
  axis?: keyof typeof AXES;
  ref?: Ref<HTMLHRElement>;
}

/** A line between things. */
export const Rule = ({ axis = "horizontal", ref }: RuleProps) => <hr ref={ref} aria-orientation={axis} className={`shrink-0 border-0 border-[#30363d] ${AXES[axis]}`} />;
