// How the frame draws each tool's surfaces.
import type { ComponentType } from "react";
import { MessageCircleQuestionMark, Shapes, type LucideIcon } from "lucide-react";
import type { Layout } from "../layout.ts";
import { AskLayout } from "./AskLayout.tsx";
import { AskSettled } from "./AskSettled.tsx";

export interface Look {
  /** What kind of surface it is, as its label says it. */
  kind: string;
  KindIcon: LucideIcon;
  /** Lays out a typed surface's parts, or null to draw the surface as it is. */
  layout: Layout | null;
  /** Draws an answered surface's answer, or null when it has no look of its own. */
  Settled: ComponentType<{ answer: unknown }> | null;
}

const LOOKS: ReadonlyMap<string, Look> = new Map([
  ["quay_ask", { kind: "Question", KindIcon: MessageCircleQuestionMark, layout: AskLayout, Settled: AskSettled }],
]);

const PLAIN: Look = { kind: "Surface", KindIcon: Shapes, layout: null, Settled: null };

/** How the surfaces of `tool` look. */
export const lookOf = (tool: string): Look => LOOKS.get(tool) ?? PLAIN;
