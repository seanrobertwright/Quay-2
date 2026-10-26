// The password-strength checker. AGENTS.md says what each rule means.

export type StrengthReport = { score: number; failed: string[] };

/** Which of the three rules in AGENTS.md `password` fails, and how many it passes. */
export function checkStrength(password: string): StrengthReport {
  throw new Error("not implemented");
}
