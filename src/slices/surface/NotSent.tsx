import { useState } from "react";
import type { TypedText } from "./looks/index.ts";

/** What the operator had typed in a surface that ended before they sent it. `texts` holds one at least. */
export const NotSent = ({ texts }: { texts: readonly TypedText[] }) => {
  const [said, setSaid] = useState("");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(texts.map(({ text }) => text).join("\n\n"));
      setSaid("Copied");
    } catch {
      setSaid("Not copied: select the text and press Ctrl+C.");
    }
  };
  return (
    <div className="min-w-0 rounded-md border border-dashed border-[#484f58] px-2.5 py-2">
      <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-[#8b949e]">
        <p className="mr-auto">You had typed, not sent</p>
        <span role="status">{said}</span>
        <button type="button" onClick={() => void copy()} className="min-h-6 text-[#58a6ff] hover:underline">
          Copy
        </button>
      </div>
      <dl className="flex flex-col gap-1.5 wrap-anywhere">
        {texts.map(({ part, question, text }) => (
          <div key={part}>
            <dt className={texts.length > 1 ? "text-[11px] text-[#8b949e]" : "sr-only"}>{question}</dt>
            <dd className="whitespace-pre-wrap text-white">{text}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
};
