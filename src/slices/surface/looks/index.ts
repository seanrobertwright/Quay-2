// How the frame draws each tool's surfaces.
import type { ComponentType } from "react";
import { LayoutList, MessageCircleQuestionMark, Shapes, type LucideIcon } from "lucide-react";
import type { DataValues } from "../differences.ts";
import type { Layout } from "../layout.ts";
import type { SurfaceComponent } from "../surfaceTypes.ts";
import { questionsIn } from "../typed/ask.ts";
import { AskLayout } from "./AskLayout.tsx";
import { AskAsked, askTypedIn } from "./AskAsked.tsx";
import { askAnswerInLine, AskSettled } from "./AskSettled.tsx";
import { BoardLayout } from "./BoardLayout.tsx";
import type { TypedText } from "./typedText.ts";

export interface Look {
  /** What kind of surface it is, as its label says it. */
  kind: string;
  KindIcon: LucideIcon;
  /** Lays out a typed surface's parts, or null to draw the surface as it is. */
  layout: Layout | null;
  /** What a surface with these components asks, in a line. */
  asksFor: (components: readonly SurfaceComponent[]) => string;
  /** Draws an answered surface's answer, or null when it has no look of its own. */
  Settled: ComponentType<{ answer: unknown }> | null;
  /** An answered surface's answer, in a line, or null when it has no words of its own. */
  answerInLine: (answer: unknown) => string | null;
  /** Draws what a surface with these components asked, with nothing in it to click, or null when it has no look of its own. */
  Asked: ComponentType<{ components: readonly SurfaceComponent[] }> | null;
  /** The texts the operator typed in a surface with these components, of what is unsent in it. */
  typedIn: (components: readonly SurfaceComponent[], unsent: DataValues) => TypedText[];
}

const PLAIN: Look = { kind: "Surface", KindIcon: Shapes, layout: null, asksFor: () => "Surface", Settled: null, answerInLine: () => null, Asked: null, typedIn: () => [] };

const LOOKS: ReadonlyMap<string, Look> = new Map<string, Look>([
  ["quay_ask", { kind: "Question", KindIcon: MessageCircleQuestionMark, layout: AskLayout, asksFor: (components) => questionsIn(components).map(({ question }) => question)[0] ?? "Question", Settled: AskSettled, answerInLine: askAnswerInLine, Asked: AskAsked, typedIn: askTypedIn }],
  ["quay_board", { ...PLAIN, kind: "Board", KindIcon: LayoutList, layout: BoardLayout, asksFor: () => "Board" }],
]);

/** How the surfaces of `tool` look. */
export const lookOf = (tool: string): Look => LOOKS.get(tool) ?? PLAIN;
