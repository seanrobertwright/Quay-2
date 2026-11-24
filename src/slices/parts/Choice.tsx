import { useId, useMemo, useState, type ReactNode, type Ref } from "react";
import { FieldNote } from "./FieldNote.tsx";
import { FIELD } from "./fieldStyles.ts";
import { keyed } from "./keyed.ts";
import { OptionChip } from "./OptionChip.tsx";
import { OptionRow } from "./OptionRow.tsx";
import { usePaged } from "./usePaged.tsx";

export interface ChoiceOption {
  label: string;
  value: string;
  /** A second line. */
  description?: string;
  /** A word or two that sets this option apart. */
  mark?: string;
}

interface ChoiceProps {
  /** What is chosen, which names the group. Empty for a group that something else names. */
  label: string;
  /** Whether more than one may be chosen. */
  many: boolean;
  /** Whether the options are chips beside each other, and not rows. */
  chips: boolean;
  /** Whether the options can be filtered by what they read. */
  filterable: boolean;
  options: readonly ChoiceOption[];
  chosen: readonly string[];
  /** A line under the options, which also describes the group for a screen reader. An empty one keeps its room. */
  note?: string;
  onChoose: (chosen: string[]) => void;
  ref?: Ref<HTMLFieldSetElement>;
}

/** The options that read `filter`, all of them when it is empty. */
function matching(options: readonly ChoiceOption[], filter: string): readonly ChoiceOption[] {
  const sought = filter.trim().toLowerCase();
  return options.filter(({ label, description = "" }) => [label, description].some((text) => text.toLowerCase().includes(sought)));
}

const Filter = ({ filter, onFilter }: { filter: string; onFilter: (filter: string) => void }) => {
  const id = useId();
  return (
    <div className="mb-1.5">
      <label htmlFor={id} className="sr-only">
        Filter the options
      </label>
      <input id={id} type="search" placeholder="Filter" value={filter} onChange={(e) => onFilter(e.target.value)} className={FIELD} />
    </div>
  );
};

const Options = ({ chips, children }: { chips: boolean; children: ReactNode }) => (
  <div className={`flex min-w-0 gap-1.5 ${chips ? "flex-wrap" : "flex-col"}`}>{children}</div>
);

/** One choice, or several, as native radios or checkboxes. It holds no choice of its own: `chosen` is what it shows. */
export const Choice = ({ label, many, chips, filterable, options, chosen, note, onChoose, ref }: ChoiceProps) => {
  const group = useId();
  const noteId = useId();
  const [filter, setFilter] = useState("");
  const found = useMemo(() => (filterable ? matching(options, filter) : options), [filterable, options, filter]);
  const { shown, more } = usePaged(found);
  const change = (value: string, checked: boolean) => {
    if (!many) onChoose([value]);
    else onChoose(checked ? [...chosen, value] : chosen.filter((other) => other !== value));
  };
  const Option = chips ? OptionChip : OptionRow;
  return (
    <fieldset ref={ref} role={many ? undefined : "radiogroup"} aria-describedby={note ? noteId : undefined} className="min-w-0">
      {label !== "" && <legend className="mb-1 text-[11px] wrap-anywhere text-[#8b949e]">{label}</legend>}
      {filterable && <Filter filter={filter} onFilter={setFilter} />}
      <Options chips={chips}>
        {keyed(shown, ({ value }) => value).map(({ key, item }) => (
          <Option
            key={key}
            kind={many ? "checkbox" : "radio"}
            group={group}
            label={item.label}
            description={item.description}
            mark={item.mark}
            checked={chosen.includes(item.value)}
            onChange={(checked) => change(item.value, checked)}
          />
        ))}
      </Options>
      {more}
      {filterable && (
        // There from the start, so that a change in it is told
        <p role="status" className="text-[11px] text-[#8b949e]">
          {shown.length === 0 && "No option matches."}
        </p>
      )}
      <FieldNote id={noteId} note={note} />
    </fieldset>
  );
};
