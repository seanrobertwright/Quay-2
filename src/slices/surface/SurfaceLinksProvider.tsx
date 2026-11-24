import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { LinksContext, type SurfaceLinks } from "./links.ts";
import { surfaceEffects } from "./surfaceEffects.ts";

/** The link the pointer or the focus is on, and where it leads. */
interface Pointed {
  id: string;
  address: string;
}

interface SurfaceLinksProviderProps {
  /** The terminal whose surface it is. */
  terminalId: string;
  children: ReactNode;
}

/** What a frame holds, with the foot that says where its links lead and why one opened nothing. */
export const SurfaceLinksProvider = ({ terminalId, children }: SurfaceLinksProviderProps) => {
  const footId = useId();
  const [count, setCount] = useState(0);
  const [pointed, setPointed] = useState<{ pointer: Pointed | null; focus: Pointed | null }>({ pointer: null, focus: null });
  const [notice, setNotice] = useState<string | null>(null);
  // Which effect is the latest; zero once the frame is gone, so an answer that comes then is dropped.
  const latest = useRef(0);
  useEffect(
    () => () => {
      latest.current = 0;
    },
    [],
  );
  const links = useMemo<SurfaceLinks>(
    () => ({
      effects: surfaceEffects(terminalId, (effect) => {
        const mine = (latest.current += 1);
        setNotice(null);
        void effect.then((why) => {
          if (latest.current === mine) setNotice(why);
        });
      }),
      footId,
      present: () => {
        setCount((links) => links + 1);
        return () => setCount((links) => links - 1);
      },
      point: (by, id, address) =>
        setPointed((now) => {
          if (address !== null) return { ...now, [by]: { id, address } };
          return now[by]?.id === id ? { ...now, [by]: null } : now;
        }),
    }),
    [terminalId, footId],
  );
  const address = (pointed.pointer ?? pointed.focus)?.address;
  return (
    <LinksContext.Provider value={links}>
      {children}
      {notice !== null && (
        <p role="alert" className="border-t border-[#da3633]/40 bg-[#da3633]/10 px-3 py-1.5 text-[11px] wrap-anywhere text-[#ff7b72]">
          {notice}
        </p>
      )}
      {count > 0 && (
        <p
          id={footId}
          data-surface-foot
          className="min-h-6 border-t border-[#30363d] bg-[#161b22] px-3 py-1 font-mono text-[11px] wrap-anywhere text-[#8b949e]"
        >
          {address !== undefined && <bdi dir="ltr">{address}</bdi>}
        </p>
      )}
    </LinksContext.Provider>
  );
};
