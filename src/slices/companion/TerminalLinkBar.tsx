import type { LinkRef, LinkSlot, LinkSlotName, LinkSource, TerminalLink } from "../terminal/types.ts";

/** A slot's name as the companion writes it. */
export const SLOT_LABELS: Readonly<Record<LinkSlotName, string>> = { pull_request: "Pull request", ticket: "Ticket" };

/** How the companion names the source that set a slot. */
const SOURCE_LABELS: Readonly<Record<LinkSource, string>> = {
  pin: "pinned",
  launch: "from its launch",
  activity: "from agent activity",
  branch: "from the branch",
};

/** `#N`, or `owner/name#N` for a ref in another repository than the terminal's. */
export function refText(ref: LinkRef): string {
  return `${ref.repo ?? ""}#${ref.number}`;
}

/**
 * The companion header's terminal link: each filled slot with the source that set it and the
 * tickets a pull request closes, and, when it is pinned, a pin mark that unpins it; and, for a tie, the candidate strip whose buttons pin.
 * Renders nothing for a link with no slot filled and no tie.
 */
export const TerminalLinkBar = ({
  link,
  onPin,
  onUnpin,
}: {
  link: TerminalLink;
  onPin: (slot: LinkSlotName, ref: LinkRef) => void;
  onUnpin: (slot: LinkSlotName) => void;
}) => {
  // The pull request shows first when both slots are filled.
  const slots = (["pull_request", "ticket"] as const).flatMap((name) => {
    const slot = link[name];
    return slot ? [{ name, slot }] : [];
  });
  return (
    <>
      {slots.length > 0 && (
        <ul aria-label="Terminal link" className="px-3 py-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs border-t border-[#30363d]">
          {slots.map(({ name, slot }) => (
            <LinkSlotItem key={name} name={name} slot={slot} onUnpin={() => onUnpin(name)} />
          ))}
        </ul>
      )}
      {link.candidates.map((tie) => (
        <div
          key={tie.slot}
          role="group"
          aria-label="Link candidates"
          className="px-3 py-1.5 flex flex-wrap items-center gap-1.5 text-xs text-[#c9d1d9] border-t border-[#30363d] bg-[#1c2128]"
        >
          <span>This terminal may belong to:</span>
          {tie.options.map((ref) => (
            <button
              key={refText(ref)}
              type="button"
              onClick={() => onPin(tie.slot, ref)}
              title={`Pin ${SLOT_LABELS[tie.slot].toLowerCase()} ${refText(ref)} to this terminal`}
              className="min-h-6 px-2 rounded border border-[#30363d] text-[#58a6ff] hover:border-[#58a6ff]"
            >
              {refText(ref)}
            </button>
          ))}
        </div>
      ))}
    </>
  );
};

const LinkSlotItem = ({ name, slot, onUnpin }: { name: LinkSlotName; slot: LinkSlot; onUnpin: () => void }) => {
  const label = `${SLOT_LABELS[name]} ${refText(slot)}`;
  return (
    <li className="flex items-center gap-1.5 min-w-0">
      <span className="text-white truncate">{label}</span>
      {!slot.pinned && <span className="text-[#8b949e]">{SOURCE_LABELS[slot.source]}</span>}
      {slot.closes && slot.closes.length > 0 && (
        <span className="text-[#8b949e]">
          closes {slot.closes.map((number) => refText({ repo: slot.repo, number })).join(", ")}
        </span>
      )}
      {slot.pinned && (
        <button
          type="button"
          onClick={onUnpin}
          aria-label={`Unpin ${SLOT_LABELS[name].toLowerCase()} ${refText(slot)}`}
          title="Pinned. Click to unpin"
          className="min-w-6 min-h-6 flex items-center justify-center rounded text-[#58a6ff] hover:bg-[#30363d]"
        >
          <svg aria-hidden="true" width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
            <path d="M4.456.734a1.75 1.75 0 0 1 2.826.504l.613 1.327a3.08 3.08 0 0 0 2.084 1.707l2.454.584c1.332.317 1.8 1.972.832 2.94L11.06 10l3.72 3.72a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L10 11.06l-2.204 2.205c-.968.968-2.623.5-2.94-.832l-.584-2.454a3.08 3.08 0 0 0-1.707-2.084l-1.327-.613a1.75 1.75 0 0 1-.504-2.826Z" />
          </svg>
        </button>
      )}
    </li>
  );
};
