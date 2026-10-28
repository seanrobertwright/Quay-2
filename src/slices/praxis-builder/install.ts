// "Install on host…" for a workflow template (#224): what the dialog shows. Quay writes nothing
// for an install. The template file is the host's template file, so installing it is a copy
// the user makes into the template directory their host configuration names.
import { isObject } from "./model.ts";
import { COMMAND_KEYS, type CommandKey } from "./template.ts";

/** The file name a template has in the host's template directory. */
export const installTarget = (name: string) => `${name}.json`;

/** The command that starts a run from the installed template. */
export const runCommand = (name: string) => `praxis run ${name}`;

/**
 * One of a template's three commands as the saved file holds it: its arguments, the JSON of a
 * value that isn't an argument list, or missing. Never joined into a command line.
 */
export type InstallCommand = { key: CommandKey } & ({ args: string[] } | { json: string } | { missing: true });

/** The template's implementation, validation and correction commands, in that order, in full. */
export function installCommands(content: unknown): InstallCommand[] {
  return COMMAND_KEYS.map((key): InstallCommand => {
    const value = isObject(content) ? content[key] : undefined;
    if (value === undefined) return { key, missing: true };
    if (Array.isArray(value) && value.every((a) => typeof a === "string")) return { key, args: value };
    return { key, json: JSON.stringify(value) };
  });
}
