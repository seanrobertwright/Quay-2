export type Contact = { id: string; name: string; email: string; phone: string };

/**
 * The groups of contacts that are the same person, as lists of their ids. See README.md for the
 * rule.
 */
export function findDuplicates(contacts: Contact[]): string[][] {
  throw new Error("not implemented");
}
