import { ScrollBox } from "./ScrollBox.tsx";

interface AttributedTextProps {
  /** Whose text it is, or what it is, in Quay's words. */
  label: string;
  text: string;
  /** How high it grows before it scrolls: tall for what the card is about, short for the rest. */
  kind?: "short" | "tall";
}

/**
 * Text Quay did not write, inset under a label Quay writes that says whose or what it is, such as "fix-75
 * says". The characters as they came, never Markdown, links or HTML, with line breaks and spaces kept.
 */
export const AttributedText = ({ label, text, kind = "short" }: AttributedTextProps) => (
  <ScrollBox kind={kind} label={label} labelShown>
    <p className="whitespace-pre-wrap wrap-anywhere">{text}</p>
  </ScrollBox>
);
