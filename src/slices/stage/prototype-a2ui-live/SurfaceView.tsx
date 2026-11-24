// PROTOTYPE (#711), throwaway. The companion's Surface view: Quay's frame around each surface, and the
// question card's layout, handed to the root Column through React context.
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { Check } from "lucide-react";
import { A2uiSurface } from "@a2ui/react";
import { SECONDARY } from "../../companion/buttonStyles.ts";
import { Frame } from "../prototype-a2ui-look/frame.tsx";
import { LayoutContext, drew, type Layout } from "./catalog.tsx";
import { getArrival, getVersion, livesOf, sendDraft, subscribe, type Live } from "./live.ts";

interface Question {
  id: string;
  multiple: boolean;
  options: boolean;
}
interface Answer {
  chosen?: string[];
  text?: string;
}

/** The question card: one question open at a time, Send pinned at the foot. Its state is under `/frame`. */
const AskCard = ({ live }: { live: Live }) => {
  drew("AskCard");
  const { surface } = live;
  const questions = useMemo<Question[]>(() => {
    const found: Question[] = [];
    for (let i = 0; surface.componentsModel.has(`q${i}_question`); i++) {
      const choice = surface.componentsModel.get(`q${i}_choice`);
      found.push({ id: `q${i}`, options: !!choice, multiple: choice?.properties.variant === "multipleSelection" });
    }
    return found;
  }, [surface]);
  const read = useCallback(() => {
    const model = surface.dataModel;
    const opened: number[] = model.get("/frame/opened") ?? [0];
    const at: number = model.get("/frame/at") ?? 0;
    const answers: Answer[] = model.get("/answers") ?? [];
    const answered = questions.map((q, i) => {
      const a = answers[i];
      return opened.includes(i) && (q.multiple || (a?.chosen?.length ?? 0) > 0 || (a?.text ?? "").trim() !== "");
    });
    // What a closed row says; the open question's own text is left out, so typing redraws nothing here
    const said = answers.map((a, i) => (i === at ? "" : [...(a.chosen ?? []), (a.text ?? "").trim()].filter(Boolean).join(" · ")));
    return { at, answered, said };
  }, [surface, questions]);
  const [view, setView] = useState(read);
  useEffect(() => {
    const onData = () => {
      const next = read();
      const ready = next.answered.every(Boolean);
      if (surface.dataModel.get("/frame/ready") !== ready) surface.dataModel.set("/frame/ready", ready);
      setView((now) => (JSON.stringify(now) === JSON.stringify(next) ? now : next));
    };
    const sub = surface.dataModel.subscribe("/", onData);
    onData();
    return () => sub.unsubscribe();
  }, [surface, read]);
  const open = useCallback(
    (i: number) => {
      const opened: number[] = surface.dataModel.get("/frame/opened") ?? [0];
      surface.dataModel.set("/frame/at", i);
      surface.dataModel.set("/frame/opened", [...new Set([...opened, i])]);
    },
    [surface],
  );
  const layout = useCallback<Layout>(
    (part) => (
      <>
        {surface.componentsModel.has("context") && part("context")}
        {questions.map((q, i) => {
          const isOpen = i === view.at || questions.length === 1;
          const done = view.answered[i] && !isOpen;
          return (
            <div key={q.id} data-question={i} className={`rounded-md border ${isOpen ? "border-[#484f58]" : "border-[#30363d]"}`}>
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() => open(i)}
                className="w-full p-2.5 flex items-start gap-2 text-left hover:bg-[#161b22] rounded-md"
              >
                <span
                  className={`mt-px w-4 h-4 shrink-0 rounded-full grid place-items-center text-[10px] ${done ? "bg-[#238636] text-white" : "border border-[#484f58] text-[#8b949e]"}`}
                >
                  {done ? <Check className="w-2.5 h-2.5" aria-label="answered" /> : i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  {part(`${q.id}_question`)}
                  {done && <span className="block text-[11px] text-[#58a6ff] truncate">{view.said[i] || "None of these"}</span>}
                </span>
              </button>
              {isOpen && (
                <div className="px-2.5 pb-2.5 flex flex-col gap-2 [&_legend]:sr-only">
                  {q.options && part(`${q.id}_choice`)}
                  {part(`${q.id}_text`)}
                  {i < questions.length - 1 && (
                    <button type="button" disabled={!view.answered[i]} onClick={() => open(i + 1)} className={`${SECONDARY} self-start`}>
                      Next
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
        <div data-ask-foot className="sticky bottom-0 flex items-center gap-2 pt-2 bg-[#0d1117]">
          {part("send")}
          <span className="text-[11px] text-[#8b949e]">
            {view.answered.filter(Boolean).length} of {questions.length} answered
          </span>
        </div>
      </>
    ),
    [surface, questions, view, open],
  );
  return (
    <LayoutContext.Provider value={layout}>
      <A2uiSurface surface={surface} />
    </LayoutContext.Provider>
  );
};

const Shown = ({ live }: { live: Live }) => {
  // Leaving the screen sends the unsent answer at once
  useEffect(() => () => sendDraft(live, "left"), [live]);
  const { record } = live;
  let body: ReactNode;
  if (record.settled)
    body = (
      <pre data-settled className="text-[11px] whitespace-pre-wrap break-words text-[#c9d1d9]">
        Answered and sent to the agent. {JSON.stringify(record.settled)}
      </pre>
    );
  else if (record.tool === "quay_ask") body = <AskCard live={live} />;
  else body = <A2uiSurface surface={live.surface} />;
  return (
    <section aria-label={`Surface from ${record.terminal_name}`} data-surface={record.id}>
      <Frame terminal={record.terminal_name} cli="claude" kind={record.tool === "quay_ask" ? "ask" : "raw"} title={record.title} onDismiss={() => {}}>
        {body}
      </Frame>
    </section>
  );
};

/** Redraws its caller when a surface arrives or goes, and gives the latest asking arrival. */
export const useArrival = () => {
  useSyncExternalStore(subscribe, getVersion);
  return getArrival();
};

export const SurfaceView = ({ terminalId }: { terminalId: string }) => {
  useSyncExternalStore(subscribe, getVersion);
  return (
    <div className="p-2 flex flex-col gap-2">
      {livesOf(terminalId).map((live) => (
        <Shown key={live.record.id} live={live} />
      ))}
    </div>
  );
};
