import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";

/** How high folded content is, in pixels: between five and six lines of a surface's text. */
const FOLDED_HEIGHT = 88;

/** Content that folds behind "Show all" when it is longer than a few lines. */
export const Fold = ({ children }: { children: ReactNode }) => {
  const id = useId();
  const content = useRef<HTMLDivElement>(null);
  const [long, setLong] = useState(false);
  const [shown, setShown] = useState(false);
  useLayoutEffect(() => {
    const box = content.current;
    if (!box) return;
    const measure = () => setLong(box.offsetHeight > FOLDED_HEIGHT);
    measure();
    // Its lines wrap anew as the companion's width changes
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, []);
  const folded = long && !shown;
  return (
    <div className="min-w-0">
      <div
        id={id}
        style={folded ? { maxHeight: FOLDED_HEIGHT } : undefined}
        className={folded ? "overflow-clip [mask-image:linear-gradient(black_60%,transparent)]" : undefined}
      >
        <div ref={content}>{children}</div>
      </div>
      {long && (
        <button
          type="button"
          aria-expanded={shown}
          aria-controls={id}
          onClick={() => setShown(!shown)}
          className="text-[11px] text-[#58a6ff] hover:underline"
        >
          {shown ? "Show less" : "Show all"}
        </button>
      )}
    </div>
  );
};
