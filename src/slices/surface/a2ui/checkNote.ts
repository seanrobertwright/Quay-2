interface Checked {
  validationErrors?: readonly string[];
}

/** What is wrong with what is in an input: the message of its first check that fails, empty when none does, and undefined when it has no checks. */
export const checkNote = ({ validationErrors }: Checked): string | undefined => validationErrors && (validationErrors[0] ?? "");
