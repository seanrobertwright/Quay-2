import type { ReactNode, Ref } from "react";
import { File } from "lucide-react";
import type { SurfaceLinks } from "../../links.ts";
import { usePointed } from "../usePointed.ts";

interface PointedLinkProps {
  links: SurfaceLinks;
  /** Where the link leads, as the frame's foot says it. */
  address: string;
  onClick: () => void;
  children: ReactNode;
  ref?: Ref<HTMLButtonElement>;
}

/**
 * A link that says at the frame's foot where it leads, and acts only on a click. It is a button and
 * not an anchor, so the webview has no address to follow, preload or drag.
 */
export const PointedLink = ({ links, address, onClick, children, ref }: PointedLinkProps) => {
  const pointed = usePointed(links, address);
  return (
    <button
      ref={ref}
      type="button"
      role="link"
      {...pointed}
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
