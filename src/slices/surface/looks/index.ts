// How the frame draws each tool's surfaces.
import type { ComponentType } from "react";
import { ClipboardCheck, LayoutList, MessageCircleQuestionMark, Shapes, type LucideIcon } from "lucide-react";
import type { DataValues } from "../differences.ts";
import type { Layout } from "../layout.ts";
import { RAW_TOOL } from "../rawTool.ts";
import type { SurfaceComponent, SurfaceRecord } from "../surfaceTypes.ts";
import { questionsIn } from "../typed/ask.ts";
import { titleIn } from "../typed/review.ts";
import { AskLayout } from "./AskLayout.tsx";
import { AskAsked, askTypedIn } from "./AskAsked.tsx";
import { askAnswerInLine, AskSettled } from "./AskSettled.tsx";
import { BoardLayout } from "./BoardLayout.tsx";
import { RawAsked } from "./RawAsked.tsx";
import { RawSettled } from "./RawSettled.tsx";
import { rawTypedIn } from "./rawTyped.ts";
import { ReviewLayout } from "./ReviewLayout.tsx";
import { ReviewReviewed, reviewTypedIn } from "./ReviewReviewed.tsx";
import { ReviewSettled } from "./ReviewSettled.tsx";
import { verdictWords } from "./reviewVerdicts.ts";
import type { SettledWords } from "./settledWords.ts";
import type { TypedText } from "./typedText.ts";

export interface Look {
  /** What kind of surface it is, as its label says it. */
  kind: string;
  KindIcon: LucideIcon;
  /** Lays out a typed surface's parts, or null to draw the surface as it is. */
  layout: Layout | null;
  /** What a surface with these components asks, in a line. */
  asksFor: (components: readonly SurfaceComponent[]) => string;
  /** Draws the answer of an answered surface with these components, or null when it has no look of its own. */
  Settled: ComponentType<{ answer: unknown; components: readonly SurfaceComponent[] }> | null;
  /** How an answered surface says what its answer is, or null when it says only that it was answered. */
  settledWords: (answer: unknown) => SettledWords | null;
  /** An answered surface's answer, in a line, or null when it has no words of its own. */
  answerInLine: (answer: unknown) => string | null;
  /** Draws what a surface with these components asked, with nothing in it to act on, or null when it has no look of its own. */
  Asked: ComponentType<{ components: readonly SurfaceComponent[]; record: SurfaceRecord }> | null;
  /** What that is folded behind. */
  askedLabel: string;
  /** The texts the operator typed in a surface with these components, of what is unsent in it. */
  typedIn: (components: readonly SurfaceComponent[], unsent: DataValues) => TypedText[];
}

const PLAIN: Look = { kind: "Surface", KindIcon: Shapes, layout: null, asksFor: () => "Surface", Settled: null, settledWords: () => null, answerInLine: () => null, Asked: null, askedLabel: "What was asked", typedIn: () => [] };

const LOOKS: ReadonlyMap<string, Look> = new Map<string, Look>([
  ["quay_ask", { kind: "Question", KindIcon: MessageCircleQuestionMark, layout: AskLayout, asksFor: (components) => questionsIn(components).map(({ question }) => question)[0] ?? "Question", Settled: AskSettled, settledWords: () => null, answerInLine: askAnswerInLine, Asked: AskAsked, askedLabel: "What was asked", typedIn: askTypedIn }],
  ["quay_review", { kind: "Review", KindIcon: ClipboardCheck, layout: ReviewLayout, asksFor: titleIn, Settled: ReviewSettled, settledWords: verdictWords, answerInLine: () => null, Asked: ReviewReviewed, askedLabel: "What was reviewed", typedIn: reviewTypedIn }],
  ["quay_board", { ...PLAIN, kind: "Board", KindIcon: LayoutList, layout: BoardLayout, asksFor: () => "Board" }],
  [RAW_TOOL, { ...PLAIN, Settled: RawSettled, Asked: RawAsked, askedLabel: "What was shown", typedIn: rawTypedIn }],
]);

/** How the surfaces of `tool` look. */
export const lookOf = (tool: string): Look => LOOKS.get(tool) ?? PLAIN;
