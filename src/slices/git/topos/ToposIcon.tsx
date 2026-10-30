import React from "react";

export interface ToposIconProps {
  className?: string;
}

/**
 * Topos "Hex Topology" mark, the logo spec #371 approves: a hexagon with three graph axes meeting
 * at a commit node. The viewBox is cropped from the source's 96x96 to the glyph. The source draws
 * the hexagon in slate #1E293B, which vanishes on Quay's dark panels, so it is lightened here.
 * Decorative; the heading beside it carries the name.
 */
export const ToposIcon: React.FC<ToposIconProps> = ({ className = "w-4 h-4" }) => (
  <svg
    viewBox="12 10 72 80"
    className={className}
    aria-hidden="true"
    focusable="false"
    xmlns="http://www.w3.org/2000/svg"
  >
    <polygon
      points="48,16 78,33 78,67 48,84 18,67 18,33"
      fill="none"
      stroke="#8b949e"
      strokeWidth="5"
      strokeLinejoin="round"
    />
    <line x1="48" y1="16" x2="48" y2="50" stroke="#06B6D4" strokeWidth="4" />
    <line x1="18" y1="67" x2="48" y2="50" stroke="#8B5CF6" strokeWidth="4" />
    <line x1="78" y1="67" x2="48" y2="50" stroke="#10B981" strokeWidth="4" />
    <circle cx="48" cy="50" r="8" fill="#F59E0B" />
    <circle cx="48" cy="50" r="4" fill="#FFFFFF" />
    <circle cx="48" cy="16" r="6" fill="#06B6D4" />
    <circle cx="18" cy="67" r="6" fill="#8B5CF6" />
    <circle cx="78" cy="67" r="6" fill="#10B981" />
  </svg>
);
