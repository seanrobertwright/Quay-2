import { lazy, Suspense } from "react";
import type { DataValues } from "../differences.ts";
import { loadA2ui } from "../surfaceHost.ts";
import type { SurfaceComponent } from "../surfaceTypes.ts";
import { bodyIn, COMMENT, COMMENT_LABEL, COMMENT_PART, commentOf, itemsIn } from "../typed/review.ts";
import type { TypedText } from "./typedText.ts";

const WrittenMarkdown = lazy(async () => ({ default: (await loadA2ui()).WrittenMarkdown }));

/** The comment typed in a review, of what is unsent in it. */
export function reviewTypedIn(_components: readonly SurfaceComponent[], unsent: DataValues): TypedText[] {
  const text = commentOf(unsent[COMMENT]);
  return text === null ? [] : [{ part: COMMENT_PART, question: COMMENT_LABEL, text }];
}

/** What was reviewed, with nothing in it to decide. */
export const ReviewReviewed = ({ components }: { components: readonly SurfaceComponent[] }) => {
  const items = itemsIn(components);
  return (
    <div className="flex min-w-0 flex-col gap-4 wrap-anywhere">
      <div className="flex max-w-[72ch] min-w-0 flex-col gap-2 text-[13px] leading-[21px] whitespace-pre-wrap">
        <Suspense fallback={<p className="text-[#8b949e]">Loading…</p>}>
          <WrittenMarkdown text={bodyIn(components)} />
        </Suspense>
      </div>
      {items.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {items.map(({ parts, title, detail, file }) => (
            <li key={parts.keep} className="border-l border-[#30363d] pl-2.5">
              <p className="whitespace-pre-wrap">{title}</p>
              {detail !== null && <p className="text-[11px] whitespace-pre-wrap text-[#8b949e]">{detail}</p>}
              {file !== null && <p className="font-mono text-[11px] text-[#8b949e]">{file}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
