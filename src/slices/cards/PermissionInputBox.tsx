import { useId, useMemo, useRef, useState } from "react";
import type { InputField } from "../attention/permissionInput.ts";
import { ScrollBox } from "./ScrollBox.tsx";

/** The most characters (UTF-16 code units) of one value drawn before its "Show all" is pressed. */
const VALUE_LIMIT = 20_000;

/** A value as it is drawn: a string verbatim, anything else as JSON, objects and arrays indented. */
const valueText = (value: unknown): string => (typeof value === "string" ? value : JSON.stringify(value, null, 2));

/** The first `VALUE_LIMIT` characters of `text`, or one fewer where the cut would split a surrogate pair. */
function firstPart(text: string): string {
  const splitsPair = /[\uD800-\uDBFF]/.test(text.charAt(VALUE_LIMIT - 1)) && /[\uDC00-\uDFFF]/.test(text.charAt(VALUE_LIMIT));
  return text.slice(0, splitsPair ? VALUE_LIMIT - 1 : VALUE_LIMIT);
}

interface PermissionInputBoxProps {
  /** The tool the request is for, in the box's accessible name. */
  tool: string;
  /** What the request's summary does not show; not empty. */
  rest: readonly InputField[];
}

/**
 * The rest of a permission request's input, in a scroll box of its own about ten lines high
 * (four in a short window), so that a long input does not push the request's answers away. The input
 * is the agent's text: it is drawn as plain text, never as Markdown, links or HTML, with a string's
 * line breaks and spaces kept.
 */
export const PermissionInputBox = ({ tool, rest }: PermissionInputBoxProps) => {
  const box = useRef<HTMLDivElement>(null);
  // The pressed "Show all" goes away, so keyboard focus moves to the box it was in.
  const onShowAll = () => box.current?.focus({ preventScroll: true });
  return (
    <ScrollBox ref={box} label={`Rest of the ${tool} input`} height="tall" className="font-mono space-y-2">
      {rest.map((field) => (
        <Field key={field.name ?? ""} field={field} onShowAll={onShowAll} />
      ))}
    </ScrollBox>
  );
};

/** One field: its name, then its value. A value with no name is drawn alone. */
const Field = ({ field, onShowAll }: { field: InputField; onShowAll: () => void }) => {
  const nameId = useId();
  if (field.name === null) return <Value value={field.value} onShowAll={onShowAll} />;
  return (
    <div role="group" aria-labelledby={nameId}>
      <div id={nameId} className="wrap-anywhere text-[#8b949e]">
        {field.name}
      </div>
      <Value value={field.value} onShowAll={onShowAll} />
    </div>
  );
};

/** One value's text; of a large one, the first part until its "Show all" is pressed. */
const Value = ({ value, onShowAll }: { value: unknown; onShowAll: () => void }) => {
  const [all, setAll] = useState(false);
  const text = useMemo(() => valueText(value), [value]);
  const cut = !all && text.length > VALUE_LIMIT;
  return (
    <>
      <pre className="whitespace-pre-wrap wrap-anywhere">{cut ? firstPart(text) : text}</pre>
      {cut && (
        <button
          type="button"
          onClick={() => {
            setAll(true);
            onShowAll();
          }}
          className="mt-1 h-6 px-1.5 rounded border border-[#30363d] text-[10px] text-[#8b949e] hover:text-white hover:bg-[#21262d]"
        >
          Show all ({text.length.toLocaleString("en-US")} characters)
        </button>
      )}
    </>
  );
};
