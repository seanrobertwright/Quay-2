import { createComponentImplementation } from "@a2ui/react";
import { TextApi } from "@a2ui/web_core/catalogs/basic/v1";

/** Text, shown as it is written. */
export const Text = createComponentImplementation(TextApi, ({ props }) => (
  <span className={`block whitespace-pre-wrap wrap-anywhere ${props.variant === "caption" ? "text-[11px] text-[#8b949e]" : ""}`}>{props.text}</span>
));
