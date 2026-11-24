import { useId, useMemo, useState, type ReactNode } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { spendClick } from "./clickOnly.ts";
import { LinksContext, type SurfaceEffects, type SurfaceLinks } from "./links.ts";
import { webTarget } from "./linkTarget.ts";

/** The link the pointer or the focus is on, and where it leads. */
interface Pointed {
  id: string;
  address: string;
}

/** What a frame holds, with the foot that says where its links lead. */
export const SurfaceLinksProvider = ({ children }: { children: ReactNode }) => {
  const footId = useId();
  const [count, setCount] = useState(0);
  const [pointed, setPointed] = useState<{ pointer: Pointed | null; focus: Pointed | null }>({ pointer: null, focus: null });
  const links = useMemo<SurfaceLinks>(() => {
    const effects: SurfaceEffects = {
      openUrl: (url) => {
        spendClick("openUrl");
        const target = webTarget(url);
        if (target) void openUrl(target.address);
      },
      showFile: () => {
        spendClick("showFile");
      },
    };
    return {
      effects,
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
    };
  }, [footId]);
  const address = (pointed.pointer ?? pointed.focus)?.address;
  return (
    <LinksContext.Provider value={links}>
      {children}
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
