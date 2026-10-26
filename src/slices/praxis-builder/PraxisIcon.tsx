import React from "react";

export interface PraxisIconProps {
  className?: string;
}

/**
 * Praxis "Folded P" mark (logos/icons/17-origami.svg): a P folded from six
 * faceted planes with a triangular counter. The viewBox is cropped from the
 * source's 96x96 to the glyph so it fills a 16px slot. Decorative; the button
 * around it carries the accessible name.
 */
export const PraxisIcon: React.FC<PraxisIconProps> = ({ className = "w-4 h-4" }) => (
  <svg
    viewBox="13 13 70 70"
    className={className}
    aria-hidden="true"
    focusable="false"
    xmlns="http://www.w3.org/2000/svg"
  >
    <polygon points="25,16 39,16 25,80" fill="#FB7185" />
    <polygon points="39,16 39,80 25,80" fill="#BE123C" />
    <polygon points="39,16 59,16 51,34" fill="#FDA4AF" />
    <polygon points="59,16 71,34 51,34" fill="#FB7185" />
    <polygon points="71,34 59,52 51,34" fill="#E11D48" />
    <polygon points="59,52 39,52 51,34" fill="#9F1239" />
  </svg>
);
