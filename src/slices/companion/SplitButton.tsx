import { useEffect, useId, useRef, useState } from "react";
import { usePopupLayer } from "../overlay/useOverlay.ts";
import { PRIMARY, SECONDARY } from "./buttonStyles.ts";

/** One entry in a split button's menu. */
export interface SplitItem<K extends string> {
  key: K;
  label: string;
}

const TONES = { primary: PRIMARY, secondary: SECONDARY };

/**
 * A split button: the main button runs `onMain`; the arrow beside it, named `toggleLabel`, opens a
 * menu of `items` moved through with the arrow keys. With `checked` set, the items are radio
 * items and the checked one is marked; otherwise each is a plain action.
 */
export function SplitButton<K extends string>({
  label,
  onMain,
  toggleLabel,
  menuLabel,
  items,
  checked,
  onPick,
  disabled = false,
  tone = "primary",
}: {
  label: string;
  onMain: () => void;
  toggleLabel: string;
  menuLabel: string;
  items: readonly SplitItem<K>[];
  checked?: K;
  onPick: (key: K) => void;
  disabled?: boolean;
  tone?: keyof typeof TONES;
}) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const toggle = useRef<HTMLButtonElement>(null);
  const close = () => {
    setOpen(false);
    toggle.current?.focus();
  };
  const className = TONES[tone];
  return (
    <div className="relative inline-flex">
      <button type="button" disabled={disabled} onClick={onMain} className={`${className} rounded-r-none`}>
        {label}
      </button>
      <button
        ref={toggle}
        type="button"
        aria-label={toggleLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={`${className} rounded-l-none border-l-[#0d1117] px-2`}
      >
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <SplitMenu
          id={menuId}
          label={menuLabel}
          items={items}
          checked={checked}
          onPick={(key) => {
            close();
            onPick(key);
          }}
          onClose={close}
        />
      )}
    </div>
  );
}

function SplitMenu<K extends string>({
  id,
  label,
  items,
  checked,
  onPick,
  onClose,
}: {
  id: string;
  label: string;
  items: readonly SplitItem<K>[];
  checked?: K;
  onPick: (key: K) => void;
  onClose: () => void;
}) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => {
    buttons.current[Math.max(0, items.findIndex((item) => item.key === checked))]?.focus();
    // Focus lands on the checked item once, when the menu opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // On the overlay stack, so Escape closes the menu before a lens open beside the companion.
  const menu = useRef<HTMLDivElement>(null);
  usePopupLayer(true, onClose, menu);
  const move = (from: number, by: number) => buttons.current[(from + by + items.length) % items.length]?.focus();
  return (
    <div
      ref={menu}
      id={id}
      role="menu"
      aria-label={label}
      className="absolute left-0 top-full z-10 mt-1 w-48 rounded-md border border-[#30363d] bg-[#161b22] py-1 shadow-lg"
    >
      {items.map((item, index) => (
        <button
          key={item.key}
          ref={(el) => {
            buttons.current[index] = el;
          }}
          type="button"
          role={checked === undefined ? "menuitem" : "menuitemradio"}
          aria-checked={checked === undefined ? undefined : item.key === checked}
          tabIndex={-1}
          onClick={() => onPick(item.key)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              move(index, 1);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              move(index, -1);
            } else if (e.key === "Escape" || e.key === "Tab") {
              e.preventDefault();
              onClose();
            }
          }}
          className="block w-full px-3 py-1.5 text-left text-xs text-[#c9d1d9] hover:bg-[#30363d] focus:bg-[#30363d] outline-none aria-checked:font-semibold aria-checked:text-white"
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
