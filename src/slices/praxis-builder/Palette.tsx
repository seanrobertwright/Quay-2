// The palette strip on the canvas (#226): one button per node kind, grouped Work, Flow,
// Gates and Finish. Dragging a button onto the canvas adds that kind where it is dropped,
// and pressing it adds one in the middle of the view. Dragging uses pointer events rather
// than HTML drag and drop, which Tauri's own drop handling turns off on Windows.
import { useRef, useState, type FC, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { NODE_KINDS_REGISTRY, PALETTE_GROUPS } from "./kinds.ts";
import { MAX_NODES, NODE_KINDS, type NodeKind, type XYPosition } from "./model.ts";

/** How far, in pixels, the pointer must move before a press becomes a drag. */
const DRAG_THRESHOLD = 4;

interface PaletteProps {
  /** Adds a node of `kind` at a point on screen, or in the middle of the view when `at` is null. */
  onAdd: (kind: NodeKind, at: XYPosition | null) => void;
  /** The graph already holds the most nodes the SDK allows. */
  full: boolean;
}

interface Press {
  kind: NodeKind;
  pointerId: number;
  start: XYPosition;
  /** Where the pointer is, once the press has become a drag. */
  at: XYPosition | null;
}

export const Palette: FC<PaletteProps> = ({ onAdd, full }) => {
  const root = useRef<HTMLDivElement | null>(null);
  const [press, setPress] = useState<Press | null>(null);
  // A drag ends with a click on the button it started from, which must not add a second node.
  const dragEnded = useRef(false);

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>, kind: NodeKind) => {
    if (full || e.button !== 0) return;
    dragEnded.current = false;
    e.currentTarget.setPointerCapture(e.pointerId);
    setPress({ kind, pointerId: e.pointerId, start: { x: e.clientX, y: e.clientY }, at: null });
  };
  const onPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    if (!press || e.pointerId !== press.pointerId) return;
    const at = { x: e.clientX, y: e.clientY };
    if (press.at || Math.hypot(at.x - press.start.x, at.y - press.start.y) > DRAG_THRESHOLD) setPress({ ...press, at });
  };
  const onPointerUp = (e: PointerEvent<HTMLButtonElement>) => {
    if (!press || e.pointerId !== press.pointerId) return;
    setPress(null);
    if (!press.at) return;
    dragEnded.current = true;
    // Let go over the strip itself, the drag is called off.
    const strip = root.current?.getBoundingClientRect();
    const overStrip =
      strip && e.clientX >= strip.left && e.clientX <= strip.right && e.clientY >= strip.top && e.clientY <= strip.bottom;
    if (!overStrip) onAdd(press.kind, { x: e.clientX, y: e.clientY });
  };
  const onClick = (kind: NodeKind) => {
    if (dragEnded.current) {
      dragEnded.current = false;
      return;
    }
    if (!full) onAdd(kind, null);
  };

  const dragged = press?.at ? NODE_KINDS_REGISTRY[press.kind] : null;
  return (
    <div
      ref={root}
      role="group"
      aria-label="Add a node"
      // Inside the canvas box, so it can never cover the Problems list below; it scrolls when
      // the canvas is too short for it.
      className="absolute left-3 top-3 z-10 max-h-[calc(100%-1.5rem)] overflow-y-auto flex flex-col gap-0.5 p-1 rounded-lg bg-[#161b22]/95 border border-[#30363d] shadow-lg"
    >
      {PALETTE_GROUPS.map((group, i) => (
        <div
          key={group}
          role="group"
          aria-label={group}
          className={`flex flex-col gap-0.5 ${i > 0 ? "pt-1 mt-0.5 border-t border-[#30363d]" : ""}`}
        >
          {NODE_KINDS.filter((kind) => NODE_KINDS_REGISTRY[kind].group === group).map((kind) => {
            const entry = NODE_KINDS_REGISTRY[kind];
            return (
              <button
                key={kind}
                type="button"
                aria-label={`Add a ${entry.label} node`}
                // Not `disabled`, which would drop focus; presses are ignored while full.
                aria-disabled={full || undefined}
                title={full ? `A graph holds at most ${MAX_NODES} nodes.` : `${entry.label}: ${entry.blurb} Drag onto the canvas, or press to add.`}
                onPointerDown={(e) => onPointerDown(e, kind)}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={() => setPress(null)}
                onClick={() => onClick(kind)}
                className="p-1.5 rounded-md hover:bg-[#21262d] aria-disabled:opacity-40 aria-disabled:hover:bg-transparent touch-none cursor-grab"
                style={{ color: entry.color }}
              >
                <entry.icon className="w-4 h-4" aria-hidden="true" />
              </button>
            );
          })}
        </div>
      ))}
      {dragged &&
        press?.at &&
        createPortal(
          <div
            aria-hidden="true"
            className="fixed z-50 pointer-events-none flex items-center gap-1.5 px-2 py-1 rounded-md border border-[#30363d] bg-[#161b22] shadow-lg text-xs font-semibold"
            style={{ left: press.at.x + 8, top: press.at.y + 8, color: dragged.color }}
          >
            <dragged.icon className="w-3.5 h-3.5" />
            {dragged.label}
          </div>,
          document.body
        )}
    </div>
  );
};
