import { useState } from "react";
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

/** What of `text`, in ISO 8601, a native input of `type` shows. A date alone is the start of its day. */
function shownOf(text: string, type: Type): string {
  const digits = isoDigits(text);
  if (!digits) return "";
  const { date, time } = digits;
  if (type === "date") return date ?? "";
  if (type === "time") return time ?? "";
  return date === null ? "" : `${date}T${time ?? "00:00"}`;
}

/** `zone` as a label says it, after a space: nothing for none. */
const zoneSaid = (zone: string) => (zone === "" ? "" : ` (${zone === "Z" ? "UTC" : `UTC${zone}`})`);

/** The zone `text` is written in, or while it is empty the one it was in: a native input is empty for a moment while its year is typed. */
function useZone(text: string): string {
  const [last, setLast] = useState("");
  const zone = text === "" ? last : (isoDigits(text)?.zone ?? "");
  if (zone !== last) setLast(zone);
  return zone;
}

interface DateTimeViewProps extends Omit<Parameters<typeof DateTimeField>[0], "value" | "onChange"> {
  /** ISO 8601 text. */
  text: string;
  setText: (text: string) => void;
}

const DateTimeView = ({ label, type, text, setText, ...field }: DateTimeViewProps) => {
  const written = useZone(text);
  const zone = type === "date" ? "" : written;
  return <DateTimeField label={label + zoneSaid(zone)} type={type} value={shownOf(text, type)} onChange={(now) => setText(now === "" ? "" : now + zone)} {...field} />;
};

/**
 * A labelled native input of a date, a time or both. It shows the digits as they are written, and never
 * as another zone has them: a value with a zone says which, and keeps it. One with checks has the message
 * of the first that fails under it.
 */
export const DateTimeInput = createComponentImplementation(DateTimeInputApi, ({ props, accessibilityRef }) => {
  const type: Type = props.enableTime ? (props.enableDate ? "datetime-local" : "time") : "date";
  return (
    <DateTimeView
      ref={accessibilityRef}
      label={textOf(props.label) || LABELS[type]}
      type={type}
      text={textOf(props.value)}
      setText={(text) => props.setValue(text)}
      min={shownOf(textOf(props.min), type)}
      max={shownOf(textOf(props.max), type) || LATEST[type]}
      note={checkNote(props)}
    />
  );
});
