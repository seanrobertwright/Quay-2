import { useContext } from "react";
import { createComponentImplementation } from "@a2ui/react";
import { TextApi } from "@a2ui/web_core/catalogs/basic/v1";
import { InsideButton } from "../insideButton.ts";
import { Markdown } from "../markdown/Markdown.tsx";

const TextView = ({ text, caption }: { text: string; caption: boolean }) => {
  const inline = useContext(InsideButton);
  const look = `min-w-0 whitespace-pre-wrap wrap-anywhere ${caption ? "text-[11px] text-[#8b949e]" : ""}`;
  return inline ? (
    <span className={look}>
      <Markdown text={text} inline />
    </span>
  ) : (
    <div className={`flex flex-col gap-2 ${look}`}>
      <Markdown text={text} inline={false} />
    </div>
  );
};

/** Text, as Markdown. Inside a button only its inline formatting is drawn. */
export const Text = createComponentImplementation(TextApi, ({ props }) => <TextView text={props.text ?? ""} caption={props.variant === "caption"} />);
