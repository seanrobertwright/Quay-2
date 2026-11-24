import { OptionInput, type OptionProps } from "./OptionInput.tsx";

/** One option of a choice, as small as its words: a native radio or checkbox with its label, mark and description. */
export const OptionChip = (option: OptionProps) => (
  <OptionInput option={option} className="max-w-full min-w-0 gap-1.5 rounded-2xl px-2.5 py-1">
    {({ id, markId, descriptionId }) => (
      <div className="min-w-0 wrap-anywhere">
        <label htmlFor={id} className="text-white">
          {option.label}
        </label>
        {option.mark && (
          <span id={markId} className="ml-1.5 rounded-full border border-[#a371f7]/50 px-1.5 text-[10px] text-[#d2a8ff]">
            {option.mark}
          </span>
        )}
        {option.description && (
          <span id={descriptionId} className="ml-1.5 text-[11px] text-[#8b949e]">
            {option.description}
          </span>
        )}
      </div>
    )}
  </OptionInput>
);
