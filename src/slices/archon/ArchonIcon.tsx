import React, { useId } from "react";

export interface ArchonIconProps {
  className?: string;
  useGradient?: boolean;
}

/**
 * Official Archon brand mark from archon.diy
 * The shield mark with the abstract Archon glyph, stroked with the
 * official primary gradient (#ED10EC → #8E40C8 → #06CE94) or currentColor.
 */
export const ArchonIcon: React.FC<ArchonIconProps> = ({
  className = "w-4 h-4",
  useGradient = true,
}) => {
  const gradId = useId();
  const strokeColor = useGradient ? `url(#${gradId})` : "currentColor";
  const fillColor = useGradient ? `url(#${gradId})` : "currentColor";

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-label="Archon"
      xmlns="http://www.w3.org/2000/svg"
    >
      {useGradient && (
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#ED10EC" />
            <stop offset="50%" stopColor="#8E40C8" />
            <stop offset="100%" stopColor="#06CE94" />
          </linearGradient>
        </defs>
      )}
      {/* Shield outline */}
      <path
        d="M12 2.2 C9.4 2.2 5.6 2.7 4 3.6 L4 11 C4 15.8 7.5 19.8 12 21.8 C16.5 19.8 20 15.8 20 11 L20 3.6 C18.4 2.7 14.6 2.2 12 2.2 Z"
        stroke={strokeColor}
        strokeWidth="1.6"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {/* Pen nib — diamond at top */}
      <path
        d="M12 5.6 L13.4 7 L12 8.4 L10.6 7 Z"
        stroke={strokeColor}
        strokeWidth="1.2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {/* Pen body — stem */}
      <path
        d="M12 8.4 L12 11.4"
        stroke={strokeColor}
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      {/* Curves cradling center point */}
      <path
        d="M9 11.5 C9 13.3 10.2 14.2 12 14.2 C13.8 14.2 15 13.3 15 11.5"
        stroke={strokeColor}
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      {/* Center dot */}
      <circle cx="12" cy="14.2" r="0.8" fill={fillColor} stroke="none" />
      {/* Tail down to bottom point */}
      <path
        d="M12 14.6 L12 19.4"
        stroke={strokeColor}
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
};
