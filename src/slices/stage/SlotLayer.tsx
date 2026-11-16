import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

const sameBox = (a: Box | null, b: Box) =>
  !!a && a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height;

/**
 * A layer laid over `slot` and hidden while there is none. It stays in one place in the page
 * whatever it draws over, so what it holds is never remounted and keeps its state, as Topos and
 * the Praxis Builder must. `layerClass` adds the layer's stacking order and layout; `data` goes on
 * the layer's element as data attributes.
 */
export const SlotLayer = ({
  slot,
  layerClass,
  data,
  children,
}: {
  slot: HTMLElement | null;
  layerClass: string;
  data?: Record<`data-${string}`, string | boolean | undefined>;
  children: ReactNode;
}) => {
  const [box, setBox] = useState<Box | null>(null);
  // Measured after every render as well as on resize, so a slot that moves without resizing,
  // such as the companion's view under a new link bar, is followed too.
  const measure = useRef(() => {});
  measure.current = () => {
    if (!slot) return;
    const r = slot.getBoundingClientRect();
    const next = { left: r.left, top: r.top, width: r.width, height: r.height };
    setBox((prev) => (sameBox(prev, next) ? prev : next));
  };
  useLayoutEffect(() => measure.current());
  useLayoutEffect(() => {
    if (!slot) return;
    const remeasure = () => measure.current();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(remeasure);
    observer?.observe(slot);
    window.addEventListener("resize", remeasure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", remeasure);
    };
  }, [slot]);
  return (
    <div {...data} hidden={!slot} style={slot && box ? box : undefined} className={slot ? `fixed ${layerClass}` : "hidden"}>
      {children}
    </div>
  );
};
