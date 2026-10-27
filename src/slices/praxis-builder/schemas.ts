// A node's `inputSchema` and `outputSchema` as the inspector's field table shows them
// (#226, #260): one row per property of a flat object schema, with its name, type and
// whether it is required.
import type { Json, JsonObject, ParseResult } from "./model.ts";

/** One row of the field table. */
export interface SchemaField {
  name: string;
  type: string;
  required: boolean;
  /** The property's schema as it is, so writing the row back keeps the keywords the table doesn't show. */
  keywords: JsonObject;
}

/** The JSON Schema types a row can have. */
export const FIELD_TYPES = ["string", "integer", "number", "boolean", "array", "object", "null"] as const;

/**
 * The top-level keywords a schema the table shows may have. The table edits `properties` and
 * `required`; the rest are kept as they are. Any other keyword (`oneOf`, `$ref`, `$defs`)
 * could change what the fields mean, so such a schema opens as JSON.
 */
const TABLE_KEYWORDS = new Set([
  "type",
  "properties",
  "required",
  "additionalProperties",
  "$schema",
  "$id",
  "$comment",
  "title",
  "description",
]);

/** Keywords that give a property fields or alternatives of its own, so it isn't flat. */
const NESTED_KEYWORDS = [
  "properties",
  "patternProperties",
  "additionalProperties",
  "items",
  "prefixItems",
  "contains",
  "allOf",
  "anyOf",
  "oneOf",
  "not",
  "if",
  "then",
  "else",
  "$ref",
  "$defs",
  "dependentSchemas",
];

const isObject = (v: unknown): v is JsonObject => typeof v === "object" && v !== null && !Array.isArray(v);
const hasOwn = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
const isFieldType = (t: unknown) => typeof t === "string" && (FIELD_TYPES as readonly string[]).includes(t);

/**
 * The schema's rows, or null when the table can't show it and it must be edited as JSON.
 * The table shows an object schema whose properties each have one known `type` and no
 * fields of their own, and whose `required` lists each of those properties at most once.
 */
export function schemaFields(schema: JsonObject): SchemaField[] | null {
  if (schema.type !== "object" || Object.keys(schema).some((k) => !TABLE_KEYWORDS.has(k))) return null;
  const properties = schema.properties ?? {};
  const required = schema.required ?? [];
  if (!isObject(properties) || !Array.isArray(required)) return null;
  const fields: SchemaField[] = [];
  for (const [name, property] of Object.entries(properties)) {
    if (!isObject(property) || !isFieldType(property.type)) return null;
    if (NESTED_KEYWORDS.some((k) => hasOwn(property, k))) return null;
    fields.push({ name, type: property.type as string, required: required.includes(name), keywords: property });
  }
  const names = new Set(fields.map((f) => f.name));
  if (new Set(required).size !== required.length || required.some((r) => typeof r !== "string" || !names.has(r))) {
    return null;
  }
  return fields;
}

/**
 * `schema` with its `properties` and `required` written from `fields`, in row order. Each
 * property keeps the keywords it had (a row's `keywords`) with the row's type, and the
 * schema keeps its other top-level keywords. `required` is left out only when no row is
 * required and the schema had none. Check `fieldsProblem` first: a later row with an
 * earlier row's name replaces it.
 */
export function withFields(schema: JsonObject, fields: readonly SchemaField[]): JsonObject {
  // fromEntries defines each key, so a field named `__proto__` is a property like any other.
  const properties = Object.fromEntries(fields.map((f) => [f.name, { ...f.keywords, type: f.type }]));
  const required = fields.filter((f) => f.required).map((f) => f.name);
  const next: JsonObject = { ...schema, type: "object", properties };
  if (required.length > 0 || hasOwn(schema, "required")) next.required = required;
  return next;
}

/** Why `fields` can't be written to a schema (a row with no name, or two with one), or null. */
export function fieldsProblem(fields: readonly SchemaField[]): string | null {
  const seen = new Set<string>();
  for (const [i, { name }] of fields.entries()) {
    if (name === "") return `Field ${i + 1} has no name.`;
    if (seen.has(name)) return `More than one field is named "${name}".`;
    seen.add(name);
  }
  return null;
}

/** Reads a schema typed as JSON: any JSON object. Whether it is a valid JSON Schema is the validator's call. */
export function parseSchema(text: string): ParseResult<JsonObject> {
  let value: Json;
  try {
    value = JSON.parse(text) as Json;
  } catch (e) {
    return { ok: false, message: `Not valid JSON: ${e instanceof Error ? e.message : String(e)}` };
  }
  return isObject(value) ? { ok: true, value } : { ok: false, message: "A schema must be a JSON object." };
}
