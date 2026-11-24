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

/** A Markdown image, or its text alone inside a button. */
export const MarkdownImage = ({ src, name }: MarkdownImageProps) => {
  const insideButton = useContext(InsideButton);
  if (insideButton) return name || `![](${src})`;
  return <LocalImage target={markdownImageTarget(src)} address={src} name={name} className={imageLook()} />;
};
