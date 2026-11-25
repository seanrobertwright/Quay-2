import { Markdown } from "./Markdown.tsx";
import { UntypedText } from "./untypedText.ts";

/** `text`, which an agent wrote and has nothing in it that the operator typed, as Markdown. */
export const WrittenMarkdown = ({ text }: { text: string }) => (
  <UntypedText.Provider value={() => text}>
    <Markdown text={text} inline={false} />
  </UntypedText.Provider>
);
