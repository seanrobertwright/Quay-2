import type { Ref } from "react";
import { z } from "zod";
import { createComponentImplementation } from "@a2ui/react";
import { DynamicNumberSchema, DynamicStringSchema } from "@a2ui/web_core/v1_0";
import { amountOf } from "../../../parts/amount.ts";
import { Bar } from "../../../parts/Bar.tsx";
import { textOf } from "../textOf.ts";

/** Quay's own component: how much of something counted is done. */
const ProgressApi = {
  name: "Progress",
  schema: z
    .object({
      done: DynamicNumberSchema.describe("REF:#/$defs/DynamicNumber|How much is done."),
      total: DynamicNumberSchema.describe("REF:#/$defs/DynamicNumber|How much there is."),
      label: DynamicStringSchema.describe("REF:#/$defs/DynamicString|What is counted.").optional(),
    })
    .strict(),
};

interface ProgressViewProps {
  done: unknown;
  total: unknown;
  label: string;
  barRef: Ref<HTMLSpanElement> | undefined;
}

const ProgressView = ({ done, total, label, barRef }: ProgressViewProps) => {
  const amount = amountOf(done, total);
  return (
    <div className="flex min-w-0 items-center gap-2 text-[11px] text-[#8b949e]">
      {label && <span className="min-w-0 wrap-anywhere">{label}</span>}
      {amount && (
        <>
          <span
            ref={barRef}
            role="progressbar"
            aria-label={label || "Progress"}
            aria-valuemin={0}
            aria-valuemax={amount.total}
            aria-valuenow={amount.done}
            aria-valuetext={amount.words}
            className="flex min-w-12 flex-1"
          >
            <Bar share={amount.share} tone="bg-[#58a6ff]" />
          </span>
          <span className="shrink-0">{amount.words}</span>
        </>
      )}
    </div>
  );
};

/** A bar with its amount in words. Where a binding gives no amount, the label alone. */
export const Progress = createComponentImplementation(ProgressApi, ({ props, accessibilityRef }) => (
  <ProgressView done={props.done} total={props.total} label={textOf(props.label)} barRef={accessibilityRef} />
));
