import React, { useRef } from "react";
import { clampInspectorWidth, inspectorWidthByKey, MAX_INSPECTOR_WIDTH, MIN_INSPECTOR_WIDTH } from "./stagingKeys";

/**
 * The inspector column's left edge (#382), a focusable window splitter shared by its staging and
 * details modes: drag it, or use the arrow keys, to resize the column.
 */
export const InspectorHandle: React.FC<{ width: number; onWidth: (width: number) => void; label: string }> = ({ width, onWidth, label }) => {
  const drag = useRef<{ pointerId: number; x: number; width: number } | null>(null);
  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex -- WAI-ARIA 1.2 focusable window splitter (separator with aria-valuenow)
    <div role="separator" tabIndex={0}
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={MIN_INSPECTOR_WIDTH}
      aria-valuemax={MAX_INSPECTOR_WIDTH}
      aria-valuetext={`${width} px`}
      title="Drag, or use the arrow keys, to resize the inspector"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { pointerId: e.pointerId, x: e.clientX, width };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (d && d.pointerId === e.pointerId) onWidth(clampInspectorWidth(d.width - (e.clientX - d.x)));
      }}
      onPointerUp={(e) => {
        if (drag.current?.pointerId === e.pointerId) drag.current = null;
      }}
      onPointerCancel={() => (drag.current = null)}
      onKeyDown={(e) => {
        const next = inspectorWidthByKey(width, e.key, e.shiftKey);
        if (next === null) return;
        e.preventDefault();
        onWidth(next);
      }}
      className="group/handle absolute top-0 bottom-0 left-0 z-20 w-[9px] -ml-[5px] cursor-col-resize flex justify-center outline-none touch-none"
    >
      <div className="w-px h-full group-hover/handle:bg-[#58a6ff] group-focus-visible/handle:w-[2px] group-focus-visible/handle:bg-[#58a6ff]" />
    </div>
  );
};
