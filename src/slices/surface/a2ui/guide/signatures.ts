// The catalog's components and functions, each as one line. Everything in a line is read from its schema,
// and a schema of a kind that has no notation here throws.
import { z } from "zod";
import { SYSTEM_FUNCTIONS, type Catalog } from "@a2ui/web_core/v1_0";
import type { ReactCatalogComponent } from "@a2ui/react";

/** The standard's own types that the guide names instead of spelling them out. */
const NAMED: Readonly<Record<string, string>> = {
  ComponentId: "id",
  Child: "id",
  ChildList: "children",
  Action: "action",
  CheckRule: "check",
  DataBinding: "binding",
  FunctionCall: "call",
  DynamicValue: "any~",
};

/** The name by which a schema's description refers to a type of the standard. */
const refOf = ({ description = "" }: z.ZodTypeAny) => /^REF:\S*\/(\w+)/.exec(description)?.[1] ?? "";

/** `schema` without what wraps it: that it may be left out, a default, or a check of the whole. */
function unwrap(schema: z.ZodTypeAny): z.ZodTypeAny {
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodDefault) return unwrap(schema._def.innerType as z.ZodTypeAny);
  return schema instanceof z.ZodEffects ? unwrap(schema.innerType() as z.ZodTypeAny) : schema;
}

/** The default `schema` has, after ` = `, or nothing. */
function defaultOf(schema: z.ZodTypeAny): string {
  if (schema instanceof z.ZodDefault) return ` = ${String(schema._def.defaultValue())}`;
  return schema instanceof z.ZodOptional ? defaultOf(schema.unwrap() as z.ZodTypeAny) : "";
}

function numberType(schema: z.ZodNumber): string {
  const bounds = [schema.minValue === null ? "" : ` >= ${schema.minValue}`, schema.maxValue === null ? "" : ` <= ${schema.maxValue}`];
  return (schema.isInt ? "integer" : "number") + bounds.join("");
}

function listType({ element, _def: { minLength } }: z.ZodArray<z.ZodTypeAny>): string {
  const of = typeOf(element);
  return `${of.includes("|") && !of.startsWith("{") ? `(${of})` : of}[${minLength ? `${minLength.value}+` : ""}]`;
}

/** `string~` for a string, a binding or a call. */
function unionType(options: readonly z.ZodTypeAny[]): string {
  const types = options.map(typeOf);
  const literal = types.filter((type) => type !== "binding" && type !== "call");
  if (types.length - literal.length < 2) return types.join("|");
  return literal.length === 1 ? `${literal[0]}~` : `(${literal.join("|")})~`;
}

/** `schema` in the guide's notation. */
function typeOf(schema: z.ZodTypeAny): string {
  const named = NAMED[refOf(schema)];
  if (named) return named;
  const inner = unwrap(schema);
  if (inner !== schema) return typeOf(inner);
  if (schema instanceof z.ZodString) return "string";
  if (schema instanceof z.ZodBoolean) return "boolean";
  if (schema instanceof z.ZodNumber) return numberType(schema);
  if (schema instanceof z.ZodAny) return "any~";
  if (schema instanceof z.ZodEnum) return (schema.options as string[]).join("|");
  if (schema instanceof z.ZodArray) return listType(schema as z.ZodArray<z.ZodTypeAny>);
  if (schema instanceof z.ZodUnion) return unionType(schema.options as z.ZodTypeAny[]);
  if (schema instanceof z.ZodObject) return `{${fieldsOf(schema)}}`;
  throw new Error(`The guide has no notation for a ${(schema._def as { typeName?: string }).typeName}.`);
}

/** The properties of an object, in the order its schema has them. */
const fieldsOf = (schema: z.ZodObject<z.ZodRawShape>): string =>
  Object.entries(schema.shape)
    .map(([name, field]) => `${name}${field.isOptional() ? "?" : ""}: ${typeOf(field)}${defaultOf(field)}`)
    .join(", ");

/** The first sentence of what a schema says of itself, after a space. Nothing for one that says nothing. */
function says(description = ""): string {
  const [first] = description.split(/(?<=\.) /);
  return first === "" ? "" : ` ${first}`;
}

function signature(name: string, schema: z.ZodTypeAny): string {
  const object = unwrap(schema);
  if (!(object instanceof z.ZodObject)) throw new Error(`The schema of ${name} is no object.`);
  return `${name}(${fieldsOf(object as z.ZodObject<z.ZodRawShape>)})`;
}

/** A line for each component of `catalog`, in its order. */
export const componentLines = (catalog: Catalog<ReactCatalogComponent>): string[] =>
  [...catalog.components.values()].map(({ name, schema }) => signature(name, schema as z.ZodTypeAny) + says((schema as z.ZodTypeAny).description));

/** A line for each function of `catalog`, in its order, and after them for each that the standard itself has. */
export const functionLines = (catalog: Catalog<ReactCatalogComponent>): string[] =>
  [...catalog.functions.values(), ...SYSTEM_FUNCTIONS].map(
    ({ name, schema, returnType, ...api }) => `${signature(name, schema as z.ZodTypeAny)}: ${returnType}.${says((api as { description?: string }).description)}`,
  );
