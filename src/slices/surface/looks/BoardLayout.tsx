import type { LayoutProps } from "../layout.ts";
import { PROGRESS_PART, statParts, STEPS_PART } from "../typed/board.ts";

/** A board's parts: what it counts, its steps, and its stats in a row. */
export const BoardLayout = ({ part, components }: LayoutProps) => {
  const has = (id: string) => components.some((component) => component.id === id);
  const stats = statParts(components);
  return (
    <div className="flex min-w-0 flex-col gap-2.5">
      {has(PROGRESS_PART) && part(PROGRESS_PART)}
      {has(STEPS_PART) && part(STEPS_PART)}
      {stats.length > 0 && (
        <div className="flex min-w-0 flex-wrap gap-1.5">
          {stats.map((id) => (
            <span key={id} className="contents">
              {part(id)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};
