import { useId } from "react";
import { ScrollBox } from "./ScrollBox.tsx";

/**
 * Text Quay did not write, inset under a label Quay writes that says whose it is, such as "fix-75
 * says". The characters as they came, never Markdown, links or HTML, with line breaks and spaces kept.
 */
export const AttributedText = ({ label, text }: { label: string; text: string }) => {
  const labelId = useId();
  return (
    <div className="space-y-1">
      <p id={labelId} className="wrap-anywhere text-[11px] text-[#8b949e]">
        {label}
      </p>
      <ScrollBox labelledBy={labelId} height="short">
        <p className="whitespace-pre-wrap wrap-anywhere">{text}</p>
      </ScrollBox>
    </div>
  );
};
