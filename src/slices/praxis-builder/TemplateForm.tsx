// The workflow template form (#224): a template opens full width in the work area, under a
// read-only strip of the coding profile's stages. Its shape is checked against the SDK's
// coding-plan schema, and nothing more: the cross-field rules, warnings and readiness come from a
// host's authoring preview, which Check on host asks for when it is pressed (#596) and shows
// apart from the shape check. The Agent field takes its suggestions and warnings from the host's
// agent picker (#482). Beside Install on host…, a status line shows
// the template's state on the Praxis host from the host catalog (#363, #451), with the host's
// readiness reason when it has installed the template but can't run it. The three commands are
// argument lists edited a row at a time. Quay never splits a command line and never runs or
// resolves a command. A Template | Runs switch turns the work area to the template's runs on the
// host (#452), where a run's detail is drawn on the same stage strip (#453) and Run starts one (#454).
import { useEffect, useId, useMemo, useState, type FC, type ReactNode } from "react";
import { ArrowDown, ArrowUp, CircleAlert, CircleCheck, Download, Info, ListChecks, LoaderCircle, Plus, X } from "lucide-react";
import { AgentIdField } from "./AgentIdField.tsx";
import type { AgentPicker } from "./agentPicker.ts";
import { described, FieldMessages, inputBaseClass, inputClass, labelClass, SeverityIcon } from "./ConfigForms.tsx";
import { isDirty, type Draft } from "./drafts.ts";
import { hostConditionView } from "./hostCondition.ts";
import { HostStatusLine, type TemplateHost } from "./HostStatusLine.tsx";
import type { HostCondition, RunInTerminal } from "./praxisHost.ts";
import { RunsView } from "./RunsView.tsx";
import { StageStrip } from "./StageStrip.tsx";
import {
  asString,
  asStrings,
  Checkbox,
  COST_UNIT_LABEL,
  DurationInput,
  fieldOf,
  hintClass,
  inline,
  IntegerInput,
  issuesByPath,
  Section,
  StringList,
  Summary,
  TextInput,
} from "./RecordFields.tsx";
import { isObject, type Json } from "./model.ts";
import {
  argumentsText,
  chooseExposure,
  EMPTY_HIDDEN,
  eightyPercent,
  exposureChoice,
  integerDigits,
  jsonInteger,
  moveArgument,
  parseArguments,
  removeArgument,
  setArgument,
  type CommandKey,
  type ExposureChoice,
  type HiddenExposure,
  type StageKey,
  type TemplateEdit,
} from "./template.ts";
import { draftText, hostIssuesByPath, verdictLine, type TemplatePreview } from "./templatePreview.ts";
import { useTemplatePreview, type TemplatePreviewState } from "./useTemplatePreview.ts";
import { useValidation } from "./useValidation.ts";
import { WorkAreaSwitch, type WorkAreaView } from "./WorkAreaSwitch.tsx";
import type { GitChange, Diagnostic } from "./types.ts";

interface TemplateFormProps {
  draft: Draft;
  onEdit: (edit: TemplateEdit) => void;
  onValidated: (verdict: string | null) => void;
  /** Opens "Install on host…" for this template; only a saved file can be installed. */
  onInstall: () => void;
  /** This template's state on the Praxis host, from the host catalog; null without one. */
  host: TemplateHost | null;
  /**
   * What the Agent field suggests and warns of (#482): the host's agent picker, null when it
   * couldn't be read, and the agent ids the project already uses. Without it the field suggests nothing.
   */
  agents?: { picker: AgentPicker | null; used: readonly string[] };
  /**
   * The project whose host Check on host asks (#596), and that host's condition, which says
   * whether it can be asked. Without it the form has no Check on host.
   */
  hostCheck?: { projectPath: string; condition: HostCondition } | null;
  /**
   * Where the Runs view lists runs from, whether the builder is shown, and how a run's detail
   * opens a visible terminal for `praxis trust`; without it there is no switch.
   */
  runs?: {
    projectPath: string;
    shown: boolean;
    runInTerminal?: RunInTerminal;
    /** How the template file differs from the last commit (for Run's confirm); undefined when it doesn't. */
    changed?: GitChange;
  } | null;
}

/** The list item a pointer such as `/outputPaths/2` names, quoted, or the pointer when it names none. */
function pathAt(list: Json | undefined, pointer: string): string {
  const item = Array.isArray(list) ? list[Number(pointer.split("/")[2])] : undefined;
  return typeof item === "string" ? JSON.stringify(item) : pointer;
}

/** The codes of issues about a field the form has no input for, which "Remove field" fixes. */
const REMOVABLE = new Set(["UNSUPPORTED_FEATURE", "UNKNOWN_FIELD"]);


const EXPOSURE_CHOICES: { choice: ExposureChoice; label: string }[] = [
  { choice: "none", label: "Not declared" },
  { choice: "BOUNDED", label: "Bounded (agent uses a model)" },
  { choice: "NOT_APPLICABLE", label: "Not applicable (agent uses no model)" },
];

export const TemplateForm: FC<TemplateFormProps> = ({ draft, onEdit, onValidated, onInstall, host, agents, hostCheck, runs }) => {
  const [shownView, setShownView] = useState<WorkAreaView>("record");
  const status = useValidation("templates", draft.content);
  const verdict = status.state === "done" ? status.validation.verdict : undefined;
  useEffect(() => {
    if (verdict !== undefined) onValidated(verdict);
  }, [verdict, onValidated]);
  // Each exposure choice's values while another is chosen. They are never saved, and last
  // while the form is open.
  const [hidden, setHidden] = useState<HiddenExposure>(EMPTY_HIDDEN);
  const anchorBase = useId();
  const anchor = (key: StageKey) => `${anchorBase}-${key}`;

  const t = draft.content;
  // The host's answer is about the draft it was asked about. Once the draft differs, it is out of date.
  const preview = useTemplatePreview(hostCheck?.projectPath ?? "");
  const text = useMemo(() => draftText(t), [t]);
  const answered = preview.result?.state === "answered" ? preview.result : null;
  const stale = answered !== null && answered.checked !== text;
  const hostByPath = useMemo(() => (answered ? hostIssuesByPath(answered.preview, stale) : new Map<string, Diagnostic[]>()), [answered, stale]);

  // Each field takes the issues at its path, or under it for a command. Whatever no shown
  // field takes shows with the verdict, and a field the form has no input for gets a fix.
  // The host's diagnostics are placed the same way, after the shape check's and marked as the
  // host's; whatever no field takes shows with the host's verdict.
  const byPath = issuesByPath(status);
  const taken = new Set<string>();
  const hostTaken = new Set<string>();
  const within = (path: string) => ([p]: [string, Diagnostic[]]) => p === path || p.startsWith(`${path}/`);
  /** Everything the host says at `path` or under it. */
  const hostUnder = (path: string) => {
    const found = [...hostByPath].filter(within(path));
    for (const [p] of found) hostTaken.add(p);
    return found;
  };
  const at = (path: string) => {
    taken.add(path);
    hostTaken.add(path);
    const issues = [...(byPath.get(path) ?? []), ...(hostByPath.get(path) ?? [])];
    return issues.length > 0 ? issues : undefined;
  };
  const under = (path: string) => {
    const found = new Map([...byPath].filter(within(path)));
    for (const [p] of found) taken.add(p);
    for (const [p, issues] of hostUnder(path)) found.set(p, [...(found.get(p) ?? []), ...issues]);
    return found;
  };
  // A never-saved draft, or one whose file was deleted, has no file to install.
  const installable = draft.baseHash !== null && !draft.deletedOnDisk;
  const set = (key: string, value: Json | undefined, live = false) => onEdit({ type: "set-field", key, value, live });
  const command = (key: CommandKey, label: string, hint: string, stage: StageKey) => (
    <div id={anchor(stage)} className="scroll-mt-4">
      <ArgumentList label={label} hint={hint} value={t[key]} issues={under(`/${key}`)} path={`/${key}`} onChange={(args, live) => set(key, args, live)} />
    </div>
  );
  const exposure = isObject(t.exposure) ? t.exposure : null;
  const choice = exposureChoice(t);
  const setExposure = (field: string, value: Json, live = false) => exposure && set("exposure", { ...exposure, [field]: value }, live);
  const choose = (next: ExposureChoice) => {
    if (next === choice) return;
    const switched = chooseExposure(t, hidden, next);
    setHidden(switched.hidden);
    const label = EXPOSURE_CHOICES.find((c) => c.choice === next)?.label ?? next;
    onEdit({ type: "set-fields", values: switched.values, label: `Set exposure to ${label}` });
  };
  const stopFill = exposure ? eightyPercent(asString(exposure.allowance)) : null;
  // The exposure's own inputs show no issues of their own, so the group takes the shape check's
  // at its path and everything the host says at it or under it.
  taken.add("/exposure");
  const exposureIssues = [...(byPath.get("/exposure") ?? []), ...hostUnder("/exposure").flatMap(([, issues]) => issues)];

  const fields = (
    <>
      <Section title="Intent">
        <div id={anchor("approve")} className="scroll-mt-4">
          <TextInput
            label="Description"
            value={asString(t.description)}
            issues={at("/description")}
            onChange={(v) => set("description", v, true)}
            hint="What the plan does. A person reads it when they approve a run."
          />
        </div>
        <div id={anchor("acceptance")} className="scroll-mt-4">
          <TextInput
            label="Criteria reference"
            value={asString(t.criteriaRef)}
            issues={at("/criteriaRef")}
            onChange={(v) => set("criteriaRef", v, true)}
            hint="Where the acceptance criteria are, such as criteria/addition.md. Acceptance checks the work against them."
          />
        </div>
      </Section>

      <Section title="Commands">
        {command("implementation", "Implementation", "Runs first, to make the change.", "implementation")}
        {command("validation", "Validation", "Runs after implementation and after each correction, to check the change.", "validation")}
        {command(
          "correction",
          "Correction",
          typeof t.maxCorrections === "number" && t.maxCorrections > 0
            ? "Runs when validation fails, then validation runs again."
            : "Required even with no corrections allowed. It runs only when Max corrections is more than 0.",
          "correction"
        )}
      </Section>

      <Section title="Outputs">
        <StringList
          label="Output paths"
          addLabel="relative/path/to/file"
          items={asStrings(t.outputPaths)}
          issues={[...under("/outputPaths")].flatMap(([p, issues]) =>
            p === "/outputPaths" ? issues : issues.map((d) => ({ ...d, message: `${pathAt(t.outputPaths, p)}: ${d.message}` }))
          )}
          onChange={(items) => set("outputPaths", items)}
          hint="The files the commands may change, relative to the work tree, with forward slashes. From 1 to 256 paths."
          maxLength={4096}
          maxItems={256}
        />
      </Section>

      <Section title="Limits">
        <IntegerInput
          label="Max corrections"
          value={integerDigits(t.maxCorrections)}
          issues={at("/maxCorrections")}
          onChange={(v) => set("maxCorrections", jsonInteger(v), true)}
          hint="How many correction cycles may run. 0 turns corrections off."
        />
        <Checkbox
          label="Approve each correction again"
          checked={t.reapproveCorrections === true}
          issues={at("/reapproveCorrections")}
          onChange={(v) => set("reapproveCorrections", v)}
          hint="A person approves again before each correction runs."
        />
        <IntegerInput
          label="Max attempts"
          value={integerDigits(t.maxAttempts)}
          min={2n}
          issues={at("/maxAttempts")}
          onChange={(v) => set("maxAttempts", jsonInteger(v), true)}
          hint="Command attempts in all, implementation and validation included. At least 2."
        />
        <DurationInput
          label="Max time per command"
          value={integerDigits(t.maxTaskMs)}
          issues={at("/maxTaskMs")}
          onChange={(ms) => set("maxTaskMs", jsonInteger(ms), true)}
          hint="The longest one command may run. From 1 second to about 24.8 days."
        />
        <DurationInput
          label="Max active time"
          value={integerDigits(t.maxTotalActiveMs)}
          issues={at("/maxTotalActiveMs")}
          onChange={(ms) => set("maxTotalActiveMs", jsonInteger(ms), true)}
          hint="The active time the whole run may add up to. At least 1 second."
        />
      </Section>

      <Section title="Agent and cost">
        <AgentIdField
          label="Agent"
          value={asString(t.agent)}
          issues={at("/agent")}
          picker={agents?.picker ?? null}
          used={agents?.used ?? []}
          onChange={(v) => set("agent", v === "" ? undefined : v, true)}
          hint="A catalog agent id. Empty uses the built-in engine:local-coding."
        />
        <ExposureGroup choice={choice} issues={exposureIssues} onChoose={choose}>
          {choice === "BOUNDED" && exposure && (
            <>
              <IntegerInput
                label="Allowance"
                labelNote={COST_UNIT_LABEL}
                value={exposure.allowance}
                min={1n}
                issues={undefined}
                onChange={(v) => setExposure("allowance", v, true)}
                hint="What the agent's model use may cost. A whole number of 1 or more."
              />
              <div>
                <IntegerInput
                  label="Stop threshold"
                  labelNote={COST_UNIT_LABEL}
                  value={exposure.stopThreshold}
                  min={1n}
                  issues={undefined}
                  onChange={(v) => setExposure("stopThreshold", v, true)}
                  hint="The cost at which the run stops. A whole number of 1 or more."
                />
                <button
                  type="button"
                  onClick={() => stopFill && setExposure("stopThreshold", stopFill)}
                  aria-disabled={stopFill === null}
                  title={stopFill === null ? "Enter an allowance first." : undefined}
                  className="mt-1.5 inline-flex items-center px-2 py-1 rounded-md bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] text-xs text-[#c9d1d9] aria-disabled:opacity-50"
                >
                  Use 80% of allowance
                </button>
              </div>
              <IntegerInput
                label="Max total cost"
                labelNote={COST_UNIT_LABEL}
                value={t.maxTotalCost}
                issues={at("/maxTotalCost")}
                onChange={(v) => set("maxTotalCost", v, true)}
                hint="The most the whole run may cost. The host checks that the threshold, the allowance and this are in order; Quay doesn't."
              />
            </>
          )}
          {choice === "NOT_APPLICABLE" && exposure && (
            <TextInput
              label="Justification"
              value={asString(exposure.justification)}
              issues={undefined}
              onChange={(v) => setExposure("justification", v, true)}
              hint="Why the agent uses no model."
            />
          )}
        </ExposureGroup>
      </Section>
    </>
  );
  const untaken = [...byPath].filter(([path]) => !taken.has(path)).flatMap(([, issues]) => issues);
  // A max total cost outside a bounded exposure has no input to clear, so it gets the fix too.
  const removable = untaken.filter(
    (d) => (REMOVABLE.has(d.code) || (d.path === "/maxTotalCost" && choice !== "BOUNDED")) && d.path.split("/").length === 2
  );
  const rest = untaken.filter((d) => !removable.includes(d));
  const hostRest = [...hostByPath].filter(([path]) => !hostTaken.has(path)).flatMap(([, issues]) => issues);

  const viewSwitch = runs && <WorkAreaSwitch recordLabel="Template" shown={shownView} onShow={setShownView} />;

  if (runs && shownView === "runs") {
    return (
      <div className="flex-1 min-h-0 overflow-y-auto">
        {viewSwitch}
        <div className="max-w-3xl mx-auto px-6 py-5 space-y-4">
          <RunsView
            projectPath={runs.projectPath}
            name={draft.ref.id}
            shown={runs.shown}
            content={t}
            runInTerminal={runs.runInTerminal}
            host={host}
            onInstall={installable ? onInstall : undefined}
            unsaved={isDirty(draft)}
            changed={runs.changed}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      {viewSwitch}
      <form className="max-w-3xl mx-auto px-6 py-5 space-y-6" onSubmit={(e) => e.preventDefault()} aria-label={`Workflow template ${draft.ref.id}`}>
        <header className="space-y-2">
          <h2 className="text-sm font-semibold text-[#c9d1d9]">
            Workflow template · coding profile
            <span className="ml-2 font-mono font-normal text-[#8b949e]">{draft.ref.id}</span>
          </h2>
          <div className="flex items-start gap-2">
            <div className="flex-1 min-w-0">{host && <HostStatusLine host={host} />}</div>
            {hostCheck && <CheckOnHost condition={hostCheck.condition} checking={preview.checking} onCheck={() => preview.check(t)} />}
            <button
              type="button"
              // Not `disabled`, which would drop focus; the reason is in the title.
              aria-disabled={!installable}
              title={installable ? "How to install this template on a Praxis host" : "Save the template first: a host is given the saved file."}
              onClick={() => installable && onInstall()}
              className="aria-disabled:opacity-40 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-[#30363d] bg-[#21262d] hover:bg-[#30363d] text-xs text-white shrink-0"
            >
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
              Install on host…
            </button>
          </div>
          <p role="note" className="flex items-start gap-1.5 text-[11px] text-[#79c0ff]">
            <Info className="w-3.5 h-3.5 mt-px shrink-0" aria-hidden="true" />
            <span>
              A template runs under the coding profile, not finite-v1, and is started with{" "}
              <code className="font-mono">praxis run {draft.ref.id}</code>. Its name is its file name; rename it from the list.
            </span>
          </p>
        </header>
        <StageStrip content={t} anchor={anchor} />
        <div className="space-y-1">
          <Summary
            noun="template"
            status={status}
            recordIssues={rest}
            accepts="The template's shape matches the coding-plan schema."
            refuses="The template's shape doesn't match the coding-plan schema"
          />
          {hostCheck && <HostVerdict state={preview} stale={stale} issues={hostRest} />}
        </div>
        {removable.length > 0 && <RemovableFields issues={removable} onRemove={(field) => set(field, undefined)} />}
        {fields}
      </form>
    </div>
  );
};

/** What the button says of a host that can't be asked, or of a check that is running. */
function checkBlocked(condition: HostCondition, checking: boolean): string | null {
  const view = hostConditionView(condition);
  if (!view.usable) return `The host can't be asked: ${view.label}.`;
  return checking ? "The host is being asked." : null;
}

/** Check on host (#596): asks the host for its authoring preview of the draft as the form holds it. */
const CheckOnHost: FC<{ condition: HostCondition; checking: boolean; onCheck: () => void }> = ({ condition, checking, onCheck }) => {
  const reasonId = useId();
  const blocked = checkBlocked(condition, checking);
  return (
    <>
      <button
        type="button"
        // Not `disabled`, which would drop focus; the reason is in the title and the description.
        aria-disabled={blocked !== null}
        aria-describedby={blocked !== null ? reasonId : undefined}
        title={blocked ?? "Ask the Praxis host what it says of this draft, saved or not. Nothing is created on the host."}
        onClick={() => blocked === null && onCheck()}
        className="ml-auto aria-disabled:opacity-40 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-[#30363d] bg-[#21262d] hover:bg-[#30363d] text-xs text-white shrink-0"
      >
        {checking ? (
          <LoaderCircle className="w-3.5 h-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        ) : (
          <ListChecks className="w-3.5 h-3.5" aria-hidden="true" />
        )}
        Check on host
      </button>
      {blocked !== null && (
        <span id={reasonId} className="sr-only">
          {blocked}
        </span>
      )}
    </>
  );
};

/** What a verdict says after its line once the draft has changed. */
const OUT_OF_DATE = "Out of date: the draft has changed since the host was asked.";

/**
 * The host's verdict on the draft (#596), with the diagnostics no field of the form shows. Its
 * line is one live region, mounted before the first check, so each change of it is announced.
 */
const HostVerdict: FC<{ state: TemplatePreviewState; stale: boolean; issues: readonly Diagnostic[] }> = ({ state, stale, issues }) => {
  const { result, checking } = state;
  const preview: TemplatePreview | null = result?.state === "answered" ? result.preview : null;
  const tone = stale ? "" : preview?.creatable ? "text-[#3fb950]" : "text-[#ff7b72]";
  return (
    <div>
      <p role="status" className="flex items-start gap-1.5 text-[11px] text-[#8b949e] empty:hidden">
        {result?.state === "failed" && <span className="text-[#ff7b72] break-words">{result.message}</span>}
        {preview && (
          <>
            {preview.creatable ? (
              <CircleCheck className={`w-3.5 h-3.5 mt-px shrink-0 ${tone}`} aria-hidden="true" />
            ) : (
              <CircleAlert className={`w-3.5 h-3.5 mt-px shrink-0 ${tone}`} aria-hidden="true" />
            )}
            <span className={`min-w-0 break-words ${tone}`}>
              {verdictLine(preview)}
              {stale && <> {OUT_OF_DATE}</>}
            </span>
          </>
        )}
        {checking && <span>{result ? "Asking the host again…" : "Asking the host…"}</span>}
      </p>
      {preview && issues.length > 0 && (
        <ul aria-label="What the host says of fields this form doesn't show" className="mt-1 space-y-0.5">
          {issues.map((d, index) => (
            // The host may say one thing of a field twice, so the place in its list is part of the key.
            <li
              key={`${d.path}|${d.code}|${index}`}
              className={`flex items-start gap-1 text-[11px] break-words ${d.severity === "error" ? "text-[#ff7b72]" : "text-[#d29922]"}`}
            >
              <SeverityIcon severity={d.severity} className="w-3 h-3 mt-px shrink-0" />
              <span className="min-w-0">
                <span className="font-mono">{fieldOf(d)}</span>: {d.message} <span className="font-mono text-[#8b949e]">{d.code}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {preview && preview.omitted > 0 && (
        <p className="mt-1 text-[11px] text-[#8b949e]">
          The host said {preview.omitted} more {preview.omitted === 1 ? "thing" : "things"}, not shown.
        </p>
      )}
    </div>
  );
};

/** The fields a hand-edited file holds that a template can't, each with a fix that removes it. */
const RemovableFields: FC<{ issues: readonly Diagnostic[]; onRemove: (field: string) => void }> = ({ issues, onRemove }) => (
  <ul aria-label="Fields this template can't have" className="space-y-1.5">
    {issues.map((d) => {
      const field = fieldOf(d);
      return (
        <li key={`${d.code}|${d.path}`} className="flex items-start gap-2 text-[11px] text-[#ff7b72]">
          <span className="min-w-0 break-words">
            <span className="font-mono">{field}</span>: {d.message} <span className="font-mono text-[#8b949e]">{d.code}</span>
          </span>
          <button
            type="button"
            onClick={() => onRemove(field)}
            aria-label={`Remove field ${field}`}
            className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] text-[11px] text-[#c9d1d9]"
          >
            <X className="w-3 h-3" aria-hidden="true" />
            Remove field
          </button>
        </li>
      );
    })}
  </ul>
);

/** Exposure as a radio group; each choice shows only its own fields, as `children`. */
const ExposureGroup: FC<{
  choice: ExposureChoice | "other";
  issues: readonly Diagnostic[] | undefined;
  onChoose: (choice: ExposureChoice) => void;
  children: ReactNode;
}> = ({ choice, issues, onChoose, children }) => {
  const hasFields = choice === "BOUNDED" || choice === "NOT_APPLICABLE";
  const name = useId();
  const messagesId = useId();
  return (
    <fieldset aria-describedby={issues?.length ? messagesId : undefined} className="space-y-3">
      <legend className={labelClass}>Exposure</legend>
      <div className="space-y-1">
        {EXPOSURE_CHOICES.map((c) => (
          <label key={c.choice} className="flex items-center gap-2 text-xs text-[#c9d1d9]">
            <input type="radio" name={name} checked={choice === c.choice} onChange={() => onChoose(c.choice)} />
            {c.label}
          </label>
        ))}
      </div>
      {choice === "other" && (
        <p className={hintClass}>This file declares an exposure Quay doesn&apos;t know. Pick one of the choices to replace it.</p>
      )}
      <FieldMessages id={messagesId} issues={issues} />
      {hasFields && <div className="space-y-3 border-l-2 border-[#30363d] pl-3">{children}</div>}
    </fieldset>
  );
};

/**
 * A command as an argument list (#224): one labelled row per argument, the executable first,
 * with buttons to add, remove and move rows, and an "Edit as JSON" box that takes a pasted
 * array. A bad array keeps the box open with its error. A command that isn't an array of
 * strings, as in a hand-edited file, opens in the box.
 */
const ArgumentList: FC<{
  label: string;
  hint: string;
  value: Json | undefined;
  path: string;
  issues: ReadonlyMap<string, Diagnostic[]>;
  onChange: (args: string[], live: boolean) => void;
}> = ({ label, hint, value, path, issues, onChange }) => {
  const groupId = useId();
  const hintId = useId();
  const messagesId = useId();
  const jsonId = useId();
  const editable = isArgumentList(value);
  const args: string[] = editable ? value : [];
  const [json, setJson] = useState<{ text: string; problem: string | null } | null>(editable ? null : { text: argumentsText(value), problem: null });
  // A change from outside (an undo, a reload) replaces what the box holds, unless the box
  // already says the same arguments in its own layout.
  const [synced, setSynced] = useState(value);
  if (synced !== value) {
    setSynced(value);
    const typed = json ? parseArguments(json.text) : null;
    // A value the rows can't show, as an undo can bring back, opens the box.
    if ((json || !editable) && !(typed?.ok && JSON.stringify(typed.args) === JSON.stringify(value))) {
      setJson({ text: argumentsText(value), problem: null });
    }
  }
  const rows = useRowIds(args.length);
  const own = issues.get(path);
  // The box shows every issue in the command, since it has no rows to put them on.
  const all = [...issues.values()].flat();
  const shown = json?.problem ? inline(json.problem) : json ? all : own;
  const row = (i: number) => issues.get(`${path}/${i}`);
  const smallButton = "p-1 rounded text-[#8b949e] hover:text-white hover:bg-[#30363d] aria-disabled:opacity-40";
  const toggle = () => {
    if (json === null) return setJson({ text: argumentsText(value), problem: null });
    if (json.problem === null && editable) setJson(null);
  };

  return (
    <div role="group" aria-labelledby={groupId} aria-describedby={hintId}>
      <div className="flex items-center justify-between gap-2">
        <span id={groupId} className={labelClass}>
          {label}
        </span>
        <button
          type="button"
          aria-pressed={json !== null}
          aria-disabled={json !== null && (json.problem !== null || !editable)}
          onClick={toggle}
          className="text-[11px] text-[#58a6ff] hover:underline aria-disabled:opacity-50 aria-disabled:no-underline"
        >
          Edit as JSON
        </button>
      </div>
      {json !== null ? (
        <>
          <label htmlFor={jsonId} className="sr-only">
            {label} as JSON
          </label>
          <textarea
            id={jsonId}
            rows={Math.min(10, Math.max(3, json.text.split("\n").length))}
            spellCheck={false}
            value={json.text}
            onChange={(e) => {
              const text = e.target.value;
              const parsed = parseArguments(text);
              setJson({ text, problem: parsed.ok ? null : parsed.problem });
              if (parsed.ok) onChange(parsed.args, true);
            }}
            className={`${inputClass} font-mono`}
            {...described(messagesId, shown, hintId)}
          />
        </>
      ) : (
        <ol className="space-y-1.5">
          {args.map((arg, i) => (
            <ArgumentRow
              key={rows.ids[i]}
              index={i}
              count={args.length}
              value={arg}
              issues={row(i)}
              smallButton={smallButton}
              onChange={(v) => onChange(setArgument(args, i, v), true)}
              onMove={(by) => {
                const moved = moveArgument(args, i, by);
                if (moved === args) return;
                rows.move(i, by);
                onChange([...moved], false);
              }}
              onRemove={() => {
                rows.remove(i);
                onChange(removeArgument(args, i), false);
              }}
            />
          ))}
          <li>
            <button
              type="button"
              onClick={() => {
                rows.add();
                onChange([...args, ""], false);
              }}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] text-xs text-[#c9d1d9]"
            >
              <Plus className="w-3 h-3" aria-hidden="true" />
              {args.length === 0 ? "Add the executable" : "Add an argument"}
            </button>
          </li>
        </ol>
      )}
      <p id={hintId} className={hintClass}>
        {hint} One argument per row; Quay never splits a command line or runs a command.
      </p>
      <FieldMessages id={messagesId} issues={shown} />
    </div>
  );
};

const isArgumentList = (value: Json | undefined): value is string[] =>
  Array.isArray(value) && value.every((a) => typeof a === "string");

/**
 * A stable key for each argument row, which moves with the row. An argument list may hold the
 * same text twice, so the text can't be the key. When the list's length changes from outside,
 * as on an undo, the rows get new keys.
 */
function useRowIds(length: number) {
  const [state, setState] = useState(() => ({ next: length, ids: Array.from({ length }, (_, i) => i) }));
  let current = state;
  if (state.ids.length !== length) {
    current = { next: state.next + length, ids: Array.from({ length }, (_, i) => state.next + i) };
    setState(current);
  }
  return {
    ids: current.ids,
    add: () => setState((s) => ({ next: s.next + 1, ids: [...s.ids, s.next] })),
    remove: (i: number) => setState((s) => ({ ...s, ids: s.ids.filter((_, j) => j !== i) })),
    move: (i: number, by: -1 | 1) =>
      setState((s) => {
        const ids = [...s.ids];
        [ids[i], ids[i + by]] = [ids[i + by], ids[i]];
        return { ...s, ids };
      }),
  };
}

const ArgumentRow: FC<{
  index: number;
  count: number;
  value: string;
  issues: readonly Diagnostic[] | undefined;
  smallButton: string;
  onChange: (value: string) => void;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
}> = ({ index, count, value, issues, smallButton, onChange, onMove, onRemove }) => {
  const id = useId();
  const messagesId = useId();
  const hintId = useId();
  const name = index === 0 ? "Executable" : `Argument ${index}`;
  return (
    <li>
      <div className="flex items-center gap-1.5">
        <label htmlFor={id} className="w-24 shrink-0 text-[11px] text-[#8b949e]">
          {name}
        </label>
        <input
          id={id}
          type="text"
          spellCheck={false}
          value={value}
          placeholder={index === 0 ? "/usr/bin/node" : ""}
          onChange={(e) => onChange(e.target.value)}
          className={`${inputBaseClass} flex-1 min-w-0 text-[#c9d1d9] font-mono`}
          {...described(messagesId, issues, index === 0 ? hintId : undefined)}
        />
        <button type="button" aria-label={`Move ${name.toLowerCase()} up`} aria-disabled={index === 0} onClick={() => onMove(-1)} className={smallButton}>
          <ArrowUp className="w-3 h-3" aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label={`Move ${name.toLowerCase()} down`}
          aria-disabled={index === count - 1}
          onClick={() => onMove(1)}
          className={smallButton}
        >
          <ArrowDown className="w-3 h-3" aria-hidden="true" />
        </button>
        <button type="button" aria-label={`Remove ${name.toLowerCase()}`} onClick={onRemove} className={smallButton}>
          <X className="w-3 h-3" aria-hidden="true" />
        </button>
      </div>
      {index === 0 && (
        <p id={hintId} className={`${hintClass} ml-[6.375rem]`}>
          An absolute path is recommended.
        </p>
      )}
      <FieldMessages id={messagesId} issues={issues} />
    </li>
  );
};
