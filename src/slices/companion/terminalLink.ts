import { LINK_SOURCES, type LinkRef, type LinkSlot, type LinkSlotName, type LinkSource, type TerminalLink } from "../terminal/types.ts";

/** A link with neither slot filled and no tie waiting. */
export const EMPTY_LINK: TerminalLink = { ticket: null, pull_request: null, candidates: [] };

/** A source Quay reads by itself, as opposed to the operator's pin. */
export type AutoLinkSource = Exclude<LinkSource, "pin">;

/** One reading of a launch fact, agent activity or branch: the refs it points a slot at. */
export interface LinkSignal {
  slot: LinkSlotName;
  source: AutoLinkSource;
  /** One ref sets the slot; two or more tie and become candidates. */
  options: readonly LinkRef[];
  /** When the signal arrived, in epoch ms. */
  at: number;
}

/** What resolution needs to know beyond the link itself. */
export interface LinkContext {
  /** The terminal's own repository (`owner/name`), or null when Quay doesn't know it. */
  ownRepo: string | null;
  /**
   * The repositories (`owner/name`) whose signals count: the terminal's own repository and every
   * Quay project's. A ref with no repository is in the terminal's own and always counts.
   */
  repos: readonly string[];
}

/** A source's rank: lower is stronger. `LINK_SOURCES` lists the sources strongest first. */
function strength(slot: Pick<LinkSlot, "source" | "pinned">): number {
  return slot.pinned ? -1 : LINK_SOURCES.indexOf(slot.source);
}

/** Whether a signal from `source` may write a slot that `held` holds. */
function mayWrite(held: LinkSlot | null, source: AutoLinkSource): boolean {
  return !held || strength(held) >= strength({ source, pinned: false });
}

/**
 * The link after `signal`. A signal writes its slot only when no stronger source holds it, so a
 * pin is never replaced, and a newer automatic signal replaces an older one of the same strength.
 * Refs in a repository outside `ctx.repos` are dropped. One ref left sets the slot; two or more
 * tie and wait as candidates for the operator to pick; none leaves the link as it was, so a merged
 * or closed pull request stays until a new signal names another.
 */
export function applyLinkSignal(link: TerminalLink | null, signal: LinkSignal, ctx: LinkContext): TerminalLink {
  const current = link ?? EMPTY_LINK;
  const options = signal.options.filter((ref) => countsFor(ref, ctx)).map((ref) => inOwnTerms(ref, ctx));
  if (options.length === 0) return current;
  const held = current[signal.slot];
  if (!mayWrite(held, signal.source)) return current;
  const others = current.candidates.filter((c) => c.slot !== signal.slot);
  if (options.length > 1) {
    return { ...current, candidates: [...others, { slot: signal.slot, source: signal.source, options, at: signal.at }] };
  }
  const [ref] = options;
  const slot: LinkSlot = { repo: ref.repo, number: ref.number, source: signal.source, pinned: false, at: signal.at };
  // The same ref named again keeps what Quay last saw of it.
  if (held && sameRef(held, ref)) {
    if (held.state !== undefined) slot.state = held.state;
    if (held.closes !== undefined) slot.closes = held.closes;
  }
  return { ...current, [signal.slot]: slot, candidates: others };
}

/** What GitHub says about a pull request: its state and the tickets its `Closes #N` names. */
export interface PullRequestFacts extends LinkRef {
  state: string;
  closes: readonly number[];
}

/**
 * The link after Quay reads `facts` about a pull request. When it is the linked one, its slot
 * records the state and closing tickets, and the first ticket it closes fills the ticket slot at
 * the pull request's strength, unless a pin or a stronger source holds that slot. A pinned pull
 * request's ticket is filled at the strongest automatic strength, `launch`: it is not a pin, so a
 * newer launch fact may replace it, and it never overrides a ticket that a launch fact or a pin set. A merged or closed
 * pull request keeps its slot. Facts about any other pull request change nothing.
 */
export function applyPullRequestFacts(link: TerminalLink | null, facts: PullRequestFacts, at: number): TerminalLink {
  const current = link ?? EMPTY_LINK;
  const held = current.pull_request;
  if (!held || !sameRef(held, facts)) return current;
  const pull_request: LinkSlot = { ...held, state: facts.state, closes: [...facts.closes] };
  const next: TerminalLink = { ...current, pull_request };
  const [first] = facts.closes;
  if (first === undefined) return next;
  const ticket = current.ticket;
  if (held.source === "pin") {
    // Only a ticket weaker than launch, or one this pull request filled before, gives way.
    const derived = ticket !== null && !ticket.pinned && ticket.repo === held.repo && (held.closes ?? []).includes(ticket.number);
    if (ticket && !derived && strength(ticket) <= strength({ source: "launch", pinned: false })) return next;
  } else if (!mayWrite(ticket, held.source)) {
    return next;
  }
  const source: AutoLinkSource = held.source === "pin" ? "launch" : held.source;
  return { ...next, ticket: { repo: held.repo, number: first, source, pinned: false, at } };
}

/** Whether two refs name the same ticket or pull request. */
function sameRef(a: LinkRef, b: LinkRef): boolean {
  return a.number === b.number && (a.repo ?? "").toLowerCase() === (b.repo ?? "").toLowerCase();
}

/** `ref` with no repository when it is in the terminal's own, so one ticket has one spelling. */
function inOwnTerms(ref: LinkRef, ctx: LinkContext): LinkRef {
  return ref.repo !== null && ctx.ownRepo !== null && ref.repo.toLowerCase() === ctx.ownRepo.toLowerCase()
    ? { repo: null, number: ref.number }
    : { repo: ref.repo, number: ref.number };
}

/**
 * The link with `ref` pinned to `slot`, as the operator picked it from a tie or from Link to...
 * A pin may point at any repository, and clears the slot's tie.
 */
export function pinLink(link: TerminalLink | null, slot: LinkSlotName, ref: LinkRef, at: number): TerminalLink {
  const current = link ?? EMPTY_LINK;
  return {
    ...current,
    [slot]: { repo: ref.repo, number: ref.number, source: "pin", pinned: true, at },
    candidates: current.candidates.filter((c) => c.slot !== slot),
  };
}

/** The link with `slot`'s pin taken off. The slot empties, so the next signal for it fills it. */
export function unpinLink(link: TerminalLink | null, slot: LinkSlotName): TerminalLink {
  const current = link ?? EMPTY_LINK;
  return current[slot]?.pinned ? { ...current, [slot]: null } : current;
}

/** Whether a ref's repository is one whose signals count. */
function countsFor(ref: LinkRef, ctx: LinkContext): boolean {
  if (ref.repo === null) return true;
  const repo = ref.repo.toLowerCase();
  return ctx.repos.some((r) => r.toLowerCase() === repo);
}
