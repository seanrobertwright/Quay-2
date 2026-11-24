import type { SurfaceComponent } from "../surfaceTypes.ts";
import { itemsIn, type ReviewAnswer } from "../typed/review.ts";
import { verdictWords } from "./reviewVerdicts.ts";

interface ReviewSettledProps {
  answer: unknown;
  components: readonly SurfaceComponent[];
}

const TERM = "text-[11px] text-[#8b949e]";

/** A decided review: what it was of, the verdict, what is to be left out, and the comment. */
export const ReviewSettled = ({ answer, components }: ReviewSettledProps) => {
  // The store hands back what `collapse` made of the operator's action.
  const { title, dropped, comment } = answer as ReviewAnswer;
  return (
    <div className="flex min-w-0 flex-col gap-2 wrap-anywhere">
      <h3 className="text-base font-semibold whitespace-pre-wrap text-white">{title}</h3>
      <dl className="flex flex-col gap-2">
        <div>
          <dt className={TERM}>Verdict</dt>
          <dd className="text-white">{verdictWords(answer)?.word}</dd>
        </div>
        {itemsIn(components).length > 0 && (
          <div>
            <dt className={TERM}>Dropped</dt>
            {dropped.map((item) => (
              <dd key={item} className="whitespace-pre-wrap text-white line-through decoration-2">
                {item}
              </dd>
            ))}
            {dropped.length === 0 && <dd className="text-[#8b949e]">Nothing</dd>}
          </div>
        )}
        {comment !== undefined && (
          <div>
            <dt className={TERM}>Comment</dt>
            <dd className="whitespace-pre-wrap text-white">{comment}</dd>
          </div>
        )}
      </dl>
    </div>
  );
};
