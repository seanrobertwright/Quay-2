import { z } from "zod";
import { createComponentImplementation } from "@a2ui/react";
import { DynamicStringSchema } from "@a2ui/web_core/v1_0";
import { textOf } from "../textOf.ts";

/** Quay's own component: one value with what it is of. */
const StatApi = {
  name: "Stat",
  schema: z
    .object({
      label: DynamicStringSchema.describe("REF:#/$defs/DynamicString|What the value is of."),
      value: DynamicStringSchema.describe("REF:#/$defs/DynamicString|The value, as it is to read."),
    })
    .strict(),
};

/** A value with its label. */
export const Stat = createComponentImplementation(StatApi, ({ props }) => (
  <span className="inline-block max-w-full rounded border border-[#30363d] bg-[#161b22] px-2 py-0.5 text-[11px] wrap-anywhere text-[#8b949e]">
    <span className="font-mono text-white">{textOf(props.value)}</span> {textOf(props.label)}
  </span>
));
