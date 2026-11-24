import { createComponentImplementation } from "@a2ui/react";
import { TextApi } from "@a2ui/web_core/catalogs/basic/v1";
import { Markdown } from "../markdown/Markdown.tsx";

/** Text, as Markdown. */
export const Text = createComponentImplementation(TextApi, ({ props }) => (
  <div className={`flex min-w-0 flex-col gap-2 whitespace-pre-wrap wrap-anywhere ${props.variant === "caption" ? "text-[11px] text-[#8b949e]" : ""}`}>
    <Markdown text={props.text ?? ""} inline={false} />
  </div>
));
