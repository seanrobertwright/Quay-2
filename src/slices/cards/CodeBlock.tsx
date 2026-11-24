import { ScrollBox } from "./ScrollBox.tsx";

/**
 * Text Quay did not write, such as a command, in a code block: the characters as they came, never
 * Markdown, links or HTML, with line breaks and spaces kept. Cards only: no surface component may
 * be an adapter over it.
 */
export const CodeBlock = ({ label, text }: { label: string; text: string }) => (
  <ScrollBox label={label} height="medium" className="font-mono">
    <pre className="whitespace-pre-wrap wrap-anywhere">
      <code>{text}</code>
    </pre>
  </ScrollBox>
);
