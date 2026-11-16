import { invoke } from "@tauri-apps/api/core";
import type { CloseReason } from "./ticketStatus.ts";
import type { TicketLocation } from "./TicketView.tsx";

/** Closes the ticket at `at` with `reason`, posting `comment` first when one is given. */
export const closeTicket = (at: TicketLocation, reason: CloseReason, comment: string | null): Promise<unknown> =>
  invoke("close_github_issue", { repoPath: at.repoPath, repo: at.repo, number: at.number, reason, comment });
