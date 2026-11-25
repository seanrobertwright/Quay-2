import { useContext } from "react";
import { createComponentImplementation } from "@a2ui/react";
import { TextApi } from "@a2ui/web_core/catalogs/basic/v1";
import type { ComponentContext } from "@a2ui/web_core/v1_0";
import { InsideButton } from "../insideButton.ts";
import { Markdown } from "../markdown/Markdown.tsx";
import { UntypedText } from "../markdown/untypedText.ts";
import { textOf } from "../textOf.ts";
import { useUntyped } from "../untyped.ts";

const TextView = ({ text, caption, context }: { text: string; caption: boolean; context: ComponentContext }) => {
  const inline = useContext(InsideButton);
  const untyped = useUntyped(context);
  const untypedText = () => textOf(untyped({ text: context.componentModel.properties.text })?.text);
  const look = `min-w-0 whitespace-pre-wrap wrap-anywhere ${caption ? "text-[11px] text-[#8b949e]" : ""}`;
  return inline ? (
    <span className={look}>
      <Markdown text={text} inline />
    </span>
  ) : (
    <div className={`flex flex-col gap-2 ${look}`}>
      <UntypedText.Provider value={untypedText}>
        <Markdown text={text} inline={false} />
      </UntypedText.Provider>
    </div>
  );
};

/** Text, as Markdown. Inside a button only its inline formatting is drawn. */
export const Text = createComponentImplementation(TextApi, ({ props, context }) => <TextView text={textOf(props.text)} caption={props.variant === "caption"} context={context} />);
