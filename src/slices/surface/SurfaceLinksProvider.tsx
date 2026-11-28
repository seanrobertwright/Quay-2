import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { FrameNotice } from "./FrameNotice.tsx";
import { LinksContext, type SurfaceLinks } from "./links.ts";
import { surfaceEffects, type Notice } from "./surfaceEffects.ts";

/** The link the pointer or the focus is on, and where it leads. */
interface Pointed {
  id: string;
  address: string;
}

interface SurfaceLinksProviderProps {
  /** The terminal whose surface it is. */
  terminalId: string;
  /** The surface's id among that terminal's. */
  id: string;
  /** Gives the focus to the frame when a notice's × takes the notice away. */
  focusFrame?: () => void;
  children: ReactNode;
}

/** What a frame holds, with the foot that says where its links lead, and why a click did nothing or what it did out of sight. */
export const SurfaceLinksProvider = ({ terminalId, id, focusFrame, children }: SurfaceLinksProviderProps) => {
  const footId = useId();
  const [count, setCount] = useState(0);
  const [pointed, setPointed] = useState<{ pointer: Pointed | null; focus: Pointed | null }>({ pointer: null, focus: null });
  const [notice, setNotice] = useState<Notice | null>(null);
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
      effects: surfaceEffects({ terminal_id: terminalId, id }, (effect) => {
        const mine = (latest.current += 1);
        setNotice(null);
        void effect.then((said) => {
          if (latest.current === mine) setNotice(said);
        });
      }),
      footId,
      present: () => {
        setCount((links) => links + 1);
        return () => setCount((links) => links - 1);
      },
      point: (by, link, address) =>
        setPointed((now) => {
          if (address !== null) return { ...now, [by]: { id: link, address } };
          return now[by]?.id === link ? { ...now, [by]: null } : now;
        }),
    }),
    [terminalId, id, footId],
  );
  const address = (pointed.pointer ?? pointed.focus)?.address;
  return (
    <LinksContext.Provider value={links}>
      {children}
      {notice !== null && (
        <FrameNotice
          kind={notice.kind}
          onDismiss={() => {
            focusFrame?.();
            setNotice(null);
          }}
        >
          {notice.text}
        </FrameNotice>
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
