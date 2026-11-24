import { createComponentImplementation } from "@a2ui/react";
import { ImageApi } from "@a2ui/web_core/catalogs/basic/v1";
import { imageTarget } from "../../imageTarget.ts";
import { LocalImage } from "./LocalImage.tsx";

const VARIANTS = {
  icon: "h-6 w-6",
  avatar: "h-10 w-10 rounded-full",
  smallFeature: "max-h-25 w-25",
  mediumFeature: "max-h-64",
  largeFeature: "max-h-100",
  header: "h-50 w-full",
} as const;

const FITS = {
  contain: "object-contain",
  cover: "object-cover",
  fill: "object-fill",
  none: "object-none",
  scaleDown: "object-scale-down",
} as const;

/** The look of an image with the standard's own defaults, and of one in Markdown. */
export const imageLook = (variant: keyof typeof VARIANTS = "mediumFeature", fit: keyof typeof FITS = "fill") =>
  `max-w-full ${VARIANTS[variant]} ${FITS[fit]}`;

/** The label of a component's `@accessibility`, once it is evaluated. */
function labelOf(props: object): string {
  const accessibility: unknown = "@accessibility" in props ? props["@accessibility"] : null;
  if (typeof accessibility !== "object" || accessibility === null || !("label" in accessibility)) return "";
  return typeof accessibility.label === "string" ? accessibility.label.trim() : "";
}

/**
 * An image file on this computer. `url` takes its path. It goes by its accessibility label, else its
 * description; with neither it only decorates, as the standard's own Image does.
 */
export const Image = createComponentImplementation(ImageApi, ({ props, accessibilityRef }) => {
  const url = typeof props.url === "string" ? props.url : "";
  const name = labelOf(props) || String(props.description ?? "").trim();
  return <LocalImage ref={accessibilityRef} target={imageTarget(url)} address={url} name={name} className={imageLook(props.variant, props.fit)} />;
});
