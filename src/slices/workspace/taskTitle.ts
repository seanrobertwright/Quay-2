// What a prompt or a message makes the title of its terminal's task. Empty when it makes none, as a
// surface's answer that Quay typed in does not.
import { isTypedAnswer } from "../surface/typedAnswer.ts";

const TITLE_LENGTH = 36;

/** The title a turn's prompt gives its terminal. */
export function promptTitle(prompt: string): string {
  if (isTypedAnswer(prompt)) return "";
  return prompt
    .trim()
    .replace(/^\[Message from peer agent[^\]]*\]:\s*/, "")
    .split("\n")[0]
    .trim()
    .slice(0, TITLE_LENGTH);
}

/** The title a message Quay types in gives the terminal it reaches. */
export function messageTitle(content: string): string {
  if (isTypedAnswer(content)) return "";
  return content
    .trim()
    .replace(/^\[Peer agent[^\]]*\]:\s*/, "")
    .slice(0, TITLE_LENGTH);
}
