// Reading values that are JSON.

export type JsonObject = Record<string, unknown>;

export const isObject = (value: unknown): value is JsonObject => typeof value === "object" && value !== null && !Array.isArray(value);

/** Whether `key` is one of `value`'s own. */
export const hasOwn = (value: object, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key);

/** `key` as a step of a JSON Pointer, with the slash before it. */
export const pointerStep = (key: string | number): string => `/${String(key).replace(/~/g, "~0").replace(/\//g, "~1")}`;
