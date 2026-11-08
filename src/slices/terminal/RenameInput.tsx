// The box that renames a terminal in place, on its Rail row or its pane header. It opens with
// the name selected; Enter or leaving the box saves a changed name, and Escape keeps the old one.
import { useEffect, useRef, useState, type FC } from "react";

interface RenameInputProps {
  name: string;
  /** Called once the box closes: with the new name, or null when the name is unchanged. */
  onDone: (newName: string | null) => void;
  className?: string;
}

export const RenameInput: FC<RenameInputProps> = ({ name, onDone, className = "" }) => {
  const [value, setValue] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);
  // Enter saves and closes the box, whose blur would otherwise save a second time.
  const done = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    const trimmed = value.trim();
    onDone(save && trimmed && trimmed !== name ? trimmed : null);
  };

  return (
    <input
      ref={inputRef}
      type="text"
      aria-label="Terminal name"
      // A pane leaves focus here rather than giving it to its terminal.
      data-no-terminal-focus
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          finish(true);
        } else if (e.key === "Escape") {
          e.preventDefault();
          finish(false);
        }
      }}
      onClick={(e) => e.stopPropagation()}
      className={`bg-[#0d1117] text-white border border-[#58a6ff] rounded px-1.5 py-0.2 text-xs font-medium focus:outline-none w-36 ${className}`}
    />
  );
};
