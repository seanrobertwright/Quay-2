import { useContext } from "react";
import { markdownImageTarget } from "../../imageTarget.ts";
import { imageLook } from "../components/Image.tsx";
import { LocalImage } from "../components/LocalImage.tsx";
import { InsideButton } from "../insideButton.ts";

interface MarkdownImageProps {
  src: string;
  /** Its text, which is empty for an image that only decorates. */
  name: string;
}

/**
 * A Markdown image, or its text alone inside a button. It has room around it, so that images beside each other
 * in a line, or in lines one above the other, do not touch. The box of one that is not shown takes a line of
 * its own, as wide as the text.
 */
export const MarkdownImage = ({ src, name }: MarkdownImageProps) => {
  const insideButton = useContext(InsideButton);
  if (insideButton) return name || `![](${src})`;
  return (
    <span className="m-0.5 inline-flex max-w-full min-w-0 has-[[data-image-refused]]:flex">
      <LocalImage target={markdownImageTarget(src)} address={src} name={name} className={imageLook()} />
    </span>
  );
};
