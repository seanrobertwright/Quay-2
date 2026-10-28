// The grant form (#223, #231): a grant opens full width in the work area, with a fixed note
// that it is only a proposal, its parent picked from the project's grants, and its delegation
// chain from the root grant down to itself. `limit` is checked inline against the parent's
// limit and the budget of every contract that binds the grant, and the backend checks the
// grant with `reduce` on a scratch mission under each of those contracts.
import { useEffect, useId, type FC } from "react";
import { ArrowDown, LoaderCircle, TriangleAlert, X } from "lucide-react";
import { described, FieldMessages, inputClass, labelClass } from "./ConfigForms.tsx";
import type { Draft } from "./drafts.ts";
import { delegationChain, GRANT_PROPOSAL_NOTE, limitIssues, parentIdProblem, type GrantEdit } from "./grant.ts";
import type { Json } from "./model.ts";
import {
  asString,
  asStrings,
  Checkbox,
  COST_HINT,
  COST_UNIT_LABEL,
  DateTimeInput,
  hintClass,
  inline,
  IntegerInput,
  issuesByField,
  ReadOnly,
  Section,
  StringList,
  Summary,
  TextInput,
  useSyncedText,
} from "./RecordFields.tsx";
import { useGrantCheck, type GrantCheckStatus } from "./useGrantCheck.ts";
import { useValidation } from "./useValidation.ts";
import type { BoundContract, DefinitionRef, Diagnostic, GrantCheck } from "./types.ts";

interface GrantFormProps {
  projectPath: string;
  draft: Draft;
  /** The ids of the grants in the project, listed or drafted, for the parent picker. */
  known: readonly string[];
  /** The ids of the grants saved in the project, which the chain and the missions read. */
  saved: readonly string[];
  /** Counts up when the builder rereads the project, so the saved records are read again. */
  refresh: number;
  onEdit: (edit: GrantEdit) => void;
  onOpen: (ref: DefinitionRef) => void;
  onValidated: (verdict: string | null) => void;
}

const NO_CHECK: GrantCheck = { chain: [], contracts: [], unchecked: [] };

export const GrantForm: FC<GrantFormProps> = ({ projectPath, draft, known, saved, refresh, onEdit, onOpen, onValidated }) => {
  const status = useValidation("grants", draft.content);
  const checkStatus = useGrantCheck(projectPath, draft.ref.id, draft.content, refresh);
  const verdict = status.state === "done" ? status.validation.verdict : undefined;
  useEffect(() => {
    if (verdict !== undefined) onValidated(verdict);
  }, [verdict, onValidated]);
  const issues = issuesByField(status);
  const c = draft.content;
  const id = draft.ref.id;
  const set = (key: string, value: Json | undefined, live = false) => onEdit({ type: "set-field", key, value, live });
  const grantCheck = checkStatus.state === "done" ? checkStatus.check : NO_CHECK;
  const limitProblems = limitIssues(c.limit, c.parentId, grantCheck);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <form className="max-w-3xl mx-auto px-6 py-5 space-y-6" onSubmit={(e) => e.preventDefault()} aria-label={`Grant ${id}`}>
        <p className="flex items-start gap-1.5 px-3 py-2 rounded-md border border-[#30363d] bg-[#161b22] text-xs text-[#c9d1d9]">
          <TriangleAlert className="w-3.5 h-3.5 mt-px shrink-0 text-[#e3b341]" aria-hidden="true" />
          {GRANT_PROPOSAL_NOTE}
        </p>
        <Summary noun="grant" status={status} recordIssues={issues.get("")} />

        <Section title="Grant">
          <ReadOnly label="Id" value={id} hint="Rename the grant from the list." />
          <TextInput
            label="Subject"
            value={asString(c.subject)}
            issues={issues.get("subject")}
            onChange={(v) => set("subject", v, true)}
            hint="Who the grant lets act, such as an agent's name."
          />
          <ReadOnly label="Profile" value={asString(c.profile)} issues={issues.get("profile")} />
        </Section>

        <Section title="Delegation">
          <ParentPicker
            self={id}
            parentId={typeof c.parentId === "string" ? c.parentId : undefined}
            known={known}
            saved={saved}
            issues={issues.get("parentId")}
            onSet={(v) => set("parentId", v)}
            onOpen={onOpen}
          />
          <Chain self={id} content={c} check={checkStatus} onOpen={onOpen} />
          <Checkbox
            label="Can delegate"
            checked={c.canDelegate === true}
            issues={issues.get("canDelegate")}
            onChange={(v) => set("canDelegate", v)}
            hint="Other grants may name this one as their parent."
          />
          <IntegerInput
            label="Depth"
            value={c.depth}
            issues={issues.get("depth")}
            onChange={(v) => set("depth", v, true)}
            hint="How many more levels of delegation may follow. A child's depth must be less than its parent's."
          />
        </Section>

        <Section title="Scope">
          <StringList label="Actions" addLabel="Add an action" items={asStrings(c.actions)} issues={issues.get("actions")} onChange={(v) => set("actions", v)} />
          <StringList label="Resources" addLabel="Add a resource" items={asStrings(c.resources)} issues={issues.get("resources")} onChange={(v) => set("resources", v)} />
          <p className={hintClass}>Each must be one of the contract&apos;s, and of the parent grant&apos;s when there is one.</p>
        </Section>

        <Section title="Limits">
          <IntegerInput
            label="Limit"
            labelNote={COST_UNIT_LABEL}
            value={c.limit}
            issues={[...(issues.get("limit") ?? []), ...limitProblems]}
            onChange={(v) => set("limit", v, true)}
            hint={`${COST_HINT} At most the parent grant's limit and the budget of every contract that binds this grant.`}
          />
        </Section>

        <Section title="Timing">
          <DateTimeInput label="Not before" value={c.notBefore} issues={issues.get("notBefore")} onChange={(v) => set("notBefore", v)} />
          <DateTimeInput label="Expires at" value={c.expiresAt} issues={issues.get("expiresAt")} onChange={(v) => set("expiresAt", v)} />
        </Section>

        <Missions check={checkStatus} onOpen={onOpen} />
      </form>
    </div>
  );
};

/**
 * The parent grant, picked from the project's grants or typed as an id for one not made yet,
 * which is flagged until it exists. Emptying it makes the grant a root. The id is set on
 * Enter or when the field loses focus; Escape puts back the stored one.
 */
const ParentPicker: FC<{
  self: string;
  parentId: string | undefined;
  known: readonly string[];
  saved: readonly string[];
  issues: readonly Diagnostic[] | undefined;
  onSet: (parentId: string | undefined) => void;
  onOpen: (ref: DefinitionRef) => void;
}> = ({ self, parentId, known, saved, issues, onSet, onOpen }) => {
  const id = useId();
  const optionsId = useId();
  const messagesId = useId();
  const hintId = useId();
  const { text, setText, onKeyDown } = useSyncedText(parentId ?? "");
  const value = text.trim();
  const problem = value === "" ? null : parentIdProblem(value, self);
  const commit = () => {
    if (problem || value === (parentId ?? "")) return;
    onSet(value === "" ? undefined : value);
  };
  const shown = problem ? inline(problem) : issues;
  const missing = parentId !== undefined && !known.includes(parentId);
  return (
    <div>
      <label htmlFor={id} className={labelClass}>
        Parent grant
      </label>
      <div className="flex gap-2">
        <input
          id={id}
          type="text"
          list={optionsId}
          spellCheck={false}
          value={text}
          placeholder="None: this is a root grant"
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else onKeyDown(e);
          }}
          className={`${inputClass} font-mono`}
          {...described(messagesId, shown, hintId)}
        />
        <datalist id={optionsId}>
          {known
            .filter((k) => k !== self)
            .map((k) => (
              <option key={k} value={k} />
            ))}
        </datalist>
        {parentId !== undefined && (
          <button
            type="button"
            aria-label="Make this a root grant"
            title="Make this a root grant"
            onClick={() => onSet(undefined)}
            className="shrink-0 p-1 text-[#8b949e] hover:text-white rounded"
          >
            <X className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        )}
      </div>
      <p id={hintId} className={hintClass}>
        Pick an existing grant, or type an id for one not made yet, which is flagged until it exists. Leave it empty for a root grant.
      </p>
      {parentId !== undefined &&
        (missing ? (
          <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-[#e3b341]">
            <TriangleAlert className="w-3 h-3" aria-hidden="true" />
            No grant has the id {parentId}.
          </p>
        ) : !saved.includes(parentId) ? (
          <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-[#e3b341]">
            <TriangleAlert className="w-3 h-3" aria-hidden="true" />
            Grant {parentId} isn&apos;t saved yet, so the chain and the missions don&apos;t see it.
          </p>
        ) : (
          <button
            type="button"
            onClick={() => onOpen({ kind: "grants", id: parentId })}
            className="mt-1 text-[11px] font-mono text-[#58a6ff] hover:underline"
          >
            Open grant {parentId}
          </button>
        ))}
      <FieldMessages id={messagesId} issues={shown} />
    </div>
  );
};

/** The delegation chain from the root grant down to this one, each with its limit (#231). */
const Chain: FC<{
  self: string;
  content: Draft["content"];
  check: GrantCheckStatus;
  onOpen: (ref: DefinitionRef) => void;
}> = ({ self, content, check, onOpen }) => {
  const headingId = useId();
  if (check.state === "failed") {
    return (
      <p role="alert" className="text-xs text-[#ff7b72] break-words">
        Couldn&apos;t read the delegation chain: {check.error}
      </p>
    );
  }
  if (check.state === "checking") return <p className="text-xs text-[#6e7681]">Reading the delegation chain…</p>;
  const { links, broken } = delegationChain(self, content.limit, content.parentId, check.check);
  return (
    <div>
      <p id={headingId} className={labelClass}>
        Delegation chain, from the root grant down
      </p>
      <ol aria-labelledby={headingId} className="space-y-0.5">
        {broken && (
          <li className="flex items-center gap-1.5 text-xs">
            <TriangleAlert className="w-3 h-3 text-[#e3b341]" aria-hidden="true" />
            <span className="font-mono text-[#c9d1d9]">{broken.id}</span>
            <span className="text-[11px] text-[#e3b341]">{broken.message}</span>
          </li>
        )}
        {links.map((link, i) => (
          <li key={link.id} className="text-xs">
            {(i > 0 || broken) && <ArrowDown className="w-3 h-3 my-0.5 text-[#6e7681]" aria-hidden="true" />}
            <span className="flex items-center gap-2">
              {link.self ? (
                <span className="font-mono text-[#c9d1d9] font-semibold">{link.id} (this grant)</span>
              ) : (
                <button type="button" onClick={() => onOpen({ kind: "grants", id: link.id })} className="font-mono text-[#58a6ff] hover:underline">
                  {link.id}
                </button>
              )}
              <span className="text-[11px] text-[#8b949e]">{link.limit === undefined ? "no limit set" : `limit ${link.limit}`}</span>
            </span>
          </li>
        ))}
      </ol>
      <p className={hintClass}>Other grants in the chain are shown as saved.</p>
    </div>
  );
};

/** How each issue's place reads under a mission: the field, and the item for a list. */
const placeOf = (d: Diagnostic) => (d.path === "" ? "" : `${d.path.slice(1).replace("/", " item ")}: `);

/** The grant's check on a scratch mission under each contract that binds it (#220, #223). */
const Missions: FC<{ check: GrantCheckStatus; onOpen: (ref: DefinitionRef) => void }> = ({ check, onOpen }) => (
  <Section title="Missions">
    {check.state === "checking" ? (
      <p className="text-xs text-[#6e7681]">Checking the grant on its contracts&apos; missions…</p>
    ) : check.state === "failed" ? (
      <p role="alert" className="text-xs text-[#ff7b72] break-words">
        Couldn&apos;t check the grant on its contracts&apos; missions: {check.error}
      </p>
    ) : (
      <>
        {check.pending && (
          <p role="status" className="flex items-center gap-1.5 text-[11px] text-[#8b949e]">
            <LoaderCircle className="w-3 h-3 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            Checking…
          </p>
        )}
        {check.check.contracts.length === 0 ? (
          <p className="text-xs text-[#6e7681]">
            No saved contract binds this grant, so it isn&apos;t checked on a mission. Bind it from a contract&apos;s Grants section.
          </p>
        ) : (
          <ul className="space-y-3">
            {check.check.contracts.map((c) => (
              <MissionResult key={c.id} contract={c} onOpen={onOpen} />
            ))}
          </ul>
        )}
        {check.check.unchecked.length > 0 && (
          <ul className="space-y-0.5">
            {/* Each line names a different file, so it is its own key. */}
            {check.check.unchecked.map((line) => (
              <li key={line} className="text-[11px] text-[#e3b341] break-words">
                Not searched: {line}
              </li>
            ))}
          </ul>
        )}
        <p className={hintClass}>
          Each contract&apos;s mission is opened from the saved contract, with the saved grants above this one granted first.
        </p>
      </>
    )}
  </Section>
);

const MissionResult: FC<{ contract: BoundContract; onOpen: (ref: DefinitionRef) => void }> = ({ contract, onOpen }) => {
  const messagesId = useId();
  const v = contract.validation;
  const errors = v ? v.diagnostics.filter((d) => d.severity === "error").length + v.omitted.errors : 0;
  return (
    <li>
      <p className="flex flex-wrap items-center gap-2 text-xs">
        <button type="button" onClick={() => onOpen({ kind: "contracts", id: contract.id })} className="font-mono text-[#58a6ff] hover:underline">
          {contract.id}
        </button>
        {contract.budget !== undefined && <span className="text-[11px] text-[#8b949e]">budget {contract.budget}</span>}
        {contract.problem ? (
          <span className="text-[11px] text-[#e3b341] break-words">Not checked: {contract.problem}</span>
        ) : v?.verdict ? (
          <span className="text-[11px] text-[#ff7b72]">
            Praxis refuses this grant on the mission ({v.verdict}): {errors} {errors === 1 ? "problem" : "problems"}.
          </span>
        ) : (
          <span className="text-[11px] text-[#3fb950]">Praxis accepts this grant on the mission.</span>
        )}
      </p>
      {v && (
        <FieldMessages id={messagesId} issues={v.diagnostics.map((d) => ({ ...d, message: `${placeOf(d)}${d.message}` }))} />
      )}
    </li>
  );
};
