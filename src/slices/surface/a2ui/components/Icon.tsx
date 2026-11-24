import { useContext, type Ref } from "react";
import { createComponentImplementation } from "@a2ui/react";
import { IconApi } from "@a2ui/web_core/catalogs/basic/v1";
import { Glyph } from "../../../parts/Glyph.tsx";
import { hasOwn, isObject } from "../../json.ts";
import { accessibilityLabel } from "../accessibilityLabel.ts";
import { iconOf, iconWords } from "../icons.ts";
import { AloneInButton } from "../insideButton.ts";

interface IconViewProps {
  name: unknown;
  named: boolean;
  iconRef: Ref<SVGSVGElement> | undefined;
}

const IconView = ({ name, named, iconRef }: IconViewProps) => {
  const alone = useContext(AloneInButton);
  const path = isObject(name) && hasOwn(name, "svgPath") ? name.svgPath : null;
  const shape = typeof path === "string" && path !== "" ? path : iconOf(name);
  if (!shape) return null;
  return (
    <>
      <Glyph ref={iconRef} shape={shape} named={named} />
      {alone && !named && <span className="sr-only">{iconWords(name)}</span>}
    </>
  );
};

/** An icon. It only decorates, unless its accessibility label names it or it is all there is of a button. */
export const Icon = createComponentImplementation(IconApi, ({ props, accessibilityRef }) => (
  <IconView name={props.name} named={accessibilityLabel(props) !== ""} iconRef={accessibilityRef} />
));
