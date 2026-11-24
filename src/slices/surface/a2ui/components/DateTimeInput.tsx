import { createComponentImplementation } from "@a2ui/react";
import { DateTimeInputApi } from "@a2ui/web_core/catalogs/basic/v1";
import { isoDigits } from "../../../../lib/dates.ts";
import { DateTimeField } from "../../../parts/DateTimeField.tsx";
import { checkNote } from "../checkNote.ts";
import { textOf } from "../textOf.ts";

type Type = Parameters<typeof DateTimeField>[0]["type"];

const LABELS = { date: "Date", time: "Time", "datetime-local": "Date and time" } as const;

/** The most a native input takes, so that its year has the four digits ISO 8601 gives one. */
const LATEST = { date: "9999-12-31", time: "", "datetime-local": "9999-12-31T23:59" } as const;

/** What of `value`, ISO 8601 text, a native input of `type` shows. A date alone is the start of its day. */
function shownOf(value: unknown, type: Type): string {
  const digits = isoDigits(textOf(value));
  if (!digits) return "";
  const { date, time } = digits;
  if (type === "date") return date ?? "";
  if (type === "time") return time ?? "";
  return date === null ? "" : `${date}T${time ?? "00:00"}`;
}

/** `zone` as a label says it, after a space: nothing for none. */
const zoneSaid = (zone: string) => (zone === "" ? "" : ` (${zone === "Z" ? "UTC" : `UTC${zone}`})`);

/**
 * A labelled native input of a date, a time or both. It shows the digits as they are written, and never
 * as another zone has them: a value with a zone says which, and keeps it. One with checks has the message
 * of the first that fails under it.
 */
export const DateTimeInput = createComponentImplementation(DateTimeInputApi, ({ props, accessibilityRef }) => {
  const type: Type = props.enableTime ? (props.enableDate ? "datetime-local" : "time") : "date";
  const zone = type === "date" ? "" : (isoDigits(textOf(props.value))?.zone ?? "");
  return (
    <DateTimeField
      ref={accessibilityRef}
      label={(textOf(props.label) || LABELS[type]) + zoneSaid(zone)}
      type={type}
      value={shownOf(props.value, type)}
      min={shownOf(props.min, type)}
      max={shownOf(props.max, type) || LATEST[type]}
      note={checkNote(props)}
      onChange={(now) => props.setValue(now === "" ? "" : now + zone)}
    />
  );
});
