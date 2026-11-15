// Unit tests for which companion view shows first (#636): the Companion opens on setting's view
// when the selected terminal has it, else the first registered view it has, else Repository.
import { test } from "node:test";
import assert from "node:assert/strict";
import { firstView, switchableViews, type CompanionView } from "./companionViews.ts";

type Ctx = { hasPr: boolean; hasTicket: boolean };
const view = (id: CompanionView<Ctx>["id"], label: string, available: (c: Ctx) => boolean): CompanionView<Ctx> => ({
  id,
  label,
  available,
  render: () => null,
});
const repository = view("repository", "Repository", (c) => !c.hasPr && !c.hasTicket);
const pullRequest = view("pull-request", "Pull request", (c) => c.hasPr);
const ticket = view("ticket", "Ticket", (c) => c.hasTicket);

test("with only the Repository view registered, it shows first whatever the setting", () => {
  const none = { hasPr: false, hasTicket: false };
  assert.equal(firstView([repository], none, "pull-request"), "repository");
  assert.equal(firstView([repository], none, "activity"), "repository");
});

test("the setting's view shows first when the terminal has it", () => {
  const both = { hasPr: true, hasTicket: true };
  assert.equal(firstView([repository, pullRequest, ticket], both, "pull-request"), "pull-request");
  assert.equal(firstView([repository, pullRequest, ticket], both, "ticket"), "ticket");
});

test("a setting whose view the terminal lacks falls back to the first registered view it has, else Repository", () => {
  const ticketOnly = { hasPr: false, hasTicket: true };
  assert.equal(firstView([pullRequest, ticket, repository], ticketOnly, "pull-request"), "ticket");
  assert.equal(firstView([pullRequest, ticket], { hasPr: false, hasTicket: false }, "pull-request"), "repository");
});

test("the view switch lists the registered views the terminal has, in registration order", () => {
  const both = { hasPr: true, hasTicket: true };
  assert.deepEqual(
    switchableViews([repository, pullRequest, ticket], both).map((v) => v.label),
    ["Pull request", "Ticket"],
  );
  assert.deepEqual(switchableViews([repository, pullRequest, ticket], { hasPr: false, hasTicket: false }).map((v) => v.id), ["repository"]);
});
