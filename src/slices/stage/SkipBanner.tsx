import { AlertTriangle } from "lucide-react";

export const SkipBanner: React.FC = () => {
  return (
    <div className="h-8 bg-[#ff7b72]/15 border-b border-[#ff7b72]/40 px-4 flex items-center gap-2 text-xs text-[#ff7b72] font-medium shrink-0 select-none">
      <AlertTriangle className="w-4 h-4 shrink-0 text-[#ff7b72]" />
      <span>
        <strong className="font-semibold uppercase tracking-wide">Dangerously Skipping Permissions:</strong> Claude runs every tool and bash command without asking.
      </span>
    </div>
  );
};
