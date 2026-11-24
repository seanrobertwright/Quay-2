import { useMemo, useState, type ReactNode } from "react";
import { ShowMore } from "./ShowMore.tsx";

/** The most of a list that is drawn before the operator asks for more, and that each press adds. */
const PAGE = 100;

/** The part of `items` to draw, and what shows more of them: null while a page holds them all. */
export function usePaged<T>(items: readonly T[]): { shown: readonly T[]; more: ReactNode } {
  const [most, setMost] = useState(PAGE);
  const shown = useMemo(() => items.slice(0, most), [items, most]);
  const more = items.length > PAGE && <ShowMore shown={shown.length} total={items.length} step={PAGE} onMore={() => setMost(shown.length + PAGE)} />;
  return { shown, more: more || null };
}
