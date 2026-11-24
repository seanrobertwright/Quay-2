import { z } from "zod";
import { createComponentImplementation } from "@a2ui/react";
import { DataBindingSchema } from "@a2ui/web_core/v1_0";
import { StepList } from "../../../parts/StepList.tsx";
import { STEP_STATES, stepsIn } from "../../../parts/steps.ts";

const StepSchema = z
  .object({
    label: z.string(),
    state: z.enum(STEP_STATES),
    note: z.string().describe("A second line under the label.").optional(),
  })
  .strict();

/** Quay's own component: a run's steps. */
const StepsApi = {
  name: "Steps",
  schema: z.object({ steps: z.union([z.array(StepSchema), DataBindingSchema]).describe("The steps in order, or a binding to them.") }).strict(),
};

/** A run's steps, each with its state. What a binding holds that is no step is left out. */
export const Steps = createComponentImplementation(StepsApi, ({ props, accessibilityRef }) => <StepList ref={accessibilityRef} steps={stepsIn(props.steps)} />);
