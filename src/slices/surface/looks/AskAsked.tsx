import type { SurfaceComponent } from "../surfaceTypes.ts";
import { ANSWERS, CONTEXT_PART, questionsIn } from "../typed/ask.ts";
import type { DataValues } from "../differences.ts";
import type { TypedText } from "./index.ts";

interface Option {
  label: string;
  description?: string;
}

/** What was typed in each question of an ask, of what is unsent in it. */
export const askTypedIn = (components: readonly SurfaceComponent[], unsent: DataValues): TypedText[] =>
  questionsIn(components).flatMap(({ parts, question }, i) => {
    const text = unsent[`${ANSWERS}/${i}/text`];
    return typeof text === "string" && text.trim() !== "" ? [{ part: parts.text, question, text }] : [];
  });

/** An ask as it was asked, with nothing in it to click. */
export const AskAsked = ({ components }: { components: readonly SurfaceComponent[] }) => {
  const byId = new Map(components.map((component) => [component.id, component]));
  const context = byId.get(CONTEXT_PART)?.text;
  const optionsOf = (part: string) => (byId.get(part)?.options ?? []) as Option[];
  return (
    <div className="flex min-w-0 flex-col gap-2 wrap-anywhere text-[#8b949e]">
      {typeof context === "string" && <p className="whitespace-pre-wrap">{context}</p>}
      {questionsIn(components).map(({ parts, question }) => (
        <div key={parts.question} className="flex flex-col gap-1">
          <p className="whitespace-pre-wrap text-[#c9d1d9]">{question}</p>
          {optionsOf(parts.choice).map(({ label, description }) => (
            <p key={label} className="border-l border-[#30363d] pl-2.5 text-[11px]">
              {label}
              {description && <span className="block">{description}</span>}
            </p>
          ))}
        </div>
      ))}
    </div>
  );
};
