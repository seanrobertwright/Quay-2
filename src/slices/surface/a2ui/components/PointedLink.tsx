import { useEffect, useId, type ReactNode } from "react";
import { File } from "lucide-react";
import type { SurfaceLinks } from "../../links.ts";

interface PointedLinkProps {
  links: SurfaceLinks;
  /** Where the link leads, as the frame's foot says it. */
  address: string;
  onClick: () => void;
  children: ReactNode;
}

/**
 * A link that says at the frame's foot where it leads, and acts only on a click. It is a button and
 * not an anchor, so the webview has no address to follow, preload or drag.
 */
export const PointedLink = ({ links, address, onClick, children }: PointedLinkProps) => {
  const id = useId();
  const { footId, point, present } = links;
  useEffect(() => {
    const gone = present();
    return () => {
      point("pointer", id, null);
      point("focus", id, null);
      gone();
    };
  }, [id, point, present]);
  return (
    <button
      type="button"
      role="link"
      aria-describedby={footId}
      onMouseEnter={() => point("pointer", id, address)}
      onMouseLeave={() => point("pointer", id, null)}
      onFocus={() => point("focus", id, address)}
      onBlur={() => point("focus", id, null)}
      onClick={onClick}
      className="max-w-full rounded-sm text-left wrap-anywhere text-[#58a6ff] hover:text-[#79c0ff] focus-visible:outline-2 focus-visible:outline-(--quay-accent)"
    >
      {children}
    </button>
  );
};

/** What a file link reads. */
export const FileLabel = ({ children }: { children: ReactNode }) => (
  <>
    <File aria-hidden="true" className="mr-0.5 inline h-3 w-3" />
    <bdi className="underline">{children}</bdi>
  </>
);
