import { useContext, type ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import { duringClick } from "../../clickOnly.ts";
import { LinksContext } from "../../links.ts";
import { linkTarget } from "../../linkTarget.ts";
import { FileLabel, PointedLink } from "../components/PointedLink.tsx";
import { InsideButton } from "../insideButton.ts";

/** A Markdown link, or its label alone inside a button. */
export const MarkdownLink = ({ href, children }: { href: string; children?: ReactNode }) => {
  const links = useContext(LinksContext);
  const insideButton = useContext(InsideButton);
  const target = linkTarget(href);
  if (!links || insideButton || !target) return children;
  if (target.kind === "file") {
    const { path } = target;
    return (
      <PointedLink links={links} address={path} onClick={() => duringClick("showFile", () => links.effects.showFile(path))}>
        <FileLabel>{children}</FileLabel>
      </PointedLink>
    );
  }
  const { address, host } = target;
  return (
    <PointedLink links={links} address={address} onClick={() => duringClick("openUrl", () => links.effects.openUrl(address))}>
      <bdi className="underline">{children}</bdi>{" "}
      <bdi className="text-[11px] text-[#8b949e]">
        <ExternalLink aria-hidden="true" className="mr-0.5 inline h-3 w-3" />
        {host}
      </bdi>
    </PointedLink>
  );
};
