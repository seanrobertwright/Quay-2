import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";

/** How high folded content is, in pixels: between five and six lines of a surface's text. */
const FOLDED_HEIGHT = 88;

interface FoldProps {
  /** How high it is folded, in pixels. */
  height?: number;
  /** What the button that unfolds it reads, and the one that folds it. */
  more?: string;
  less?: string;
  /** What it is content of, as the button's name adds where there are several. */
  of?: string;
  children: ReactNode;
}

/** Content that folds when it is longer than a few lines, behind "Show all" unless it is told otherwise. */
export const Fold = ({ height = FOLDED_HEIGHT, more = "Show all", less = "Show less", of, children }: FoldProps) => {
  const id = useId();
  const content = useRef<HTMLDivElement>(null);
  const [long, setLong] = useState(false);
  const [shown, setShown] = useState(false);
  useLayoutEffect(() => {
    const box = content.current;
    if (!box) return;
    const measure = () => setLong(box.offsetHeight > height);
    measure();
    // Its lines wrap anew as the width it has changes
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [height]);
  const folded = long && !shown;
  return (
    <div className="min-w-0">
      <div
        id={id}
        style={folded ? { maxHeight: height } : undefined}
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
          {shown ? less : more}
          {of !== undefined && <span className="sr-only">: {of}</span>}
        </button>
      )}
    </div>
  );
};
