import { OptionInput, type OptionProps } from "./OptionInput.tsx";

/** One option of a choice: a native radio or checkbox with its label, mark and description. */
export const OptionRow = (option: OptionProps) => (
  <OptionInput option={option} className="gap-2 rounded-md p-2">
    {({ id, markId, descriptionId }) => (
      <div className="min-w-0 flex-1 wrap-anywhere">
        {option.mark && (
          <span id={markId} className="float-right ml-2 rounded-full border border-[#a371f7]/50 px-1.5 text-[10px] text-[#d2a8ff]">
            {option.mark}
          </span>
        )}
        <label htmlFor={id} className="block font-semibold text-white">
          {option.label}
        </label>
        {option.description && (
          <p id={descriptionId} className="text-[11px] text-[#8b949e]">
            {option.description}
          </p>
        )}
      </div>
    )}
  </OptionInput>
);
