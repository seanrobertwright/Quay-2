/// <reference types="node" />
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { JsonObject } from "./model.ts";
import { fieldsProblem, parseSchema, schemaFields, withFields } from "./schemas.ts";

describe("schemaFields", () => {
  test("reads a flat object schema as one row per property, in order", () => {
    const fields = schemaFields({
      type: "object",
      properties: { title: { type: "string" }, count: { type: "integer", minimum: 0 } },
      required: ["count"],
    });
    assert.deepEqual(
      fields?.map(({ name, type, required }) => ({ name, type, required })),
      [
        { name: "title", type: "string", required: false },
        { name: "count", type: "integer", required: true },
      ]
    );
  });

  test("reads an object schema with no properties as no rows", () => {
    assert.deepEqual(schemaFields({ type: "object" }), []);
  });

  const unshowable: [string, JsonObject][] = [
    ["a schema that isn't an object", { type: "string" }],
    ["a schema with no type", { properties: { a: { type: "string" } } }],
    ["a combinator at the top", { type: "object", properties: {}, oneOf: [{ required: ["a"] }] }],
    ["a $ref at the top", { type: "object", $ref: "#/$defs/thing" }],
    ["properties that aren't an object", { type: "object", properties: [] }],
    ["a property that isn't an object", { type: "object", properties: { a: true } }],
    ["a property with no type", { type: "object", properties: { a: { minLength: 1 } } }],
    ["a property with a list of types", { type: "object", properties: { a: { type: ["string", "null"] } } }],
    ["a property with an unknown type", { type: "object", properties: { a: { type: "text" } } }],
    ["a nested object's fields", { type: "object", properties: { a: { type: "object", properties: { b: { type: "string" } } } } }],
    ["an array's item schema", { type: "object", properties: { a: { type: "array", items: { type: "string" } } } }],
    ["required that isn't a list", { type: "object", properties: { a: { type: "string" } }, required: "a" }],
    ["required naming no property", { type: "object", properties: { a: { type: "string" } }, required: ["b"] }],
    ["required naming a property twice", { type: "object", properties: { a: { type: "string" } }, required: ["a", "a"] }],
  ];
  for (const [what, schema] of unshowable) {
    test(`can't show ${what}`, () => {
      assert.equal(schemaFields(schema), null);
    });
  }

  test("shows a schema whose other top-level keywords are annotations", () => {
    const fields = schemaFields({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      title: "Result",
      description: "What the task hands on.",
      type: "object",
      properties: { ok: { type: "boolean" } },
      additionalProperties: false,
    });
    assert.deepEqual(fields?.map((f) => f.name), ["ok"]);
  });
});

describe("withFields", () => {
  const schema: JsonObject = {
    title: "Result",
    type: "object",
    properties: {
      summary: { description: "One line.", type: "string", minLength: 1, maxLength: 120 },
      score: { type: "number", minimum: 0, maximum: 1 },
    },
    required: ["summary"],
    additionalProperties: false,
  };
  const rows = () => schemaFields(schema)!;

  test("writes unchanged rows back as the same schema, key order included", () => {
    assert.equal(JSON.stringify(withFields(schema, rows())), JSON.stringify(schema));
  });

  test("changing a row's type keeps that property's other keywords", () => {
    const next = rows().map((f) => (f.name === "score" ? { ...f, type: "integer" } : f));
    assert.deepEqual(withFields(schema, next).properties, {
      summary: { description: "One line.", type: "string", minLength: 1, maxLength: 120 },
      score: { type: "integer", minimum: 0, maximum: 1 },
    });
  });

  test("renaming a row keeps its keywords and its place, and renames it in required", () => {
    const next = rows().map((f) => (f.name === "summary" ? { ...f, name: "headline" } : f));
    const out = withFields(schema, next);
    assert.equal(
      JSON.stringify(out.properties),
      JSON.stringify({
        headline: { description: "One line.", type: "string", minLength: 1, maxLength: 120 },
        score: { type: "number", minimum: 0, maximum: 1 },
      })
    );
    assert.deepEqual(out.required, ["headline"]);
  });

  test("marking a row required lists it in required, in row order, and keeps its keywords", () => {
    const next = rows().map((f) => (f.name === "score" ? { ...f, required: true } : f));
    const out = withFields(schema, next);
    assert.deepEqual(out.required, ["summary", "score"]);
    assert.deepEqual(out.properties, (schema.properties as JsonObject));
  });

  test("keeps the schema's other top-level keywords", () => {
    const out = withFields(schema, rows().slice(1));
    assert.equal(out.title, "Result");
    assert.equal(out.additionalProperties, false);
    assert.deepEqual(out.required, []);
    assert.deepEqual(Object.keys(out.properties as JsonObject), ["score"]);
  });

  test("a new row is a property with just its type", () => {
    const out = withFields({ type: "object" }, [{ name: "done", type: "boolean", required: true, keywords: {} }]);
    assert.deepEqual(out, { type: "object", properties: { done: { type: "boolean" } }, required: ["done"] });
  });

  test("leaves required out when no row is required and the schema had none", () => {
    const out = withFields({ type: "object" }, [{ name: "done", type: "boolean", required: false, keywords: {} }]);
    assert.deepEqual(out, { type: "object", properties: { done: { type: "boolean" } } });
  });
});

describe("fieldsProblem", () => {
  const field = (name: string) => ({ name, type: "string", required: false, keywords: {} });

  test("finds nothing wrong with distinct names", () => {
    assert.equal(fieldsProblem([field("a"), field("b")]), null);
  });

  test("says when a row has no name", () => {
    assert.equal(fieldsProblem([field("a"), field("")]), "Field 2 has no name.");
  });

  test("says when two rows share a name", () => {
    assert.equal(fieldsProblem([field("a"), field("b"), field("a")]), 'More than one field is named "a".');
  });
});

describe("parseSchema", () => {
  test("reads a JSON object", () => {
    assert.deepEqual(parseSchema('{ "type": "object", "properties": {} }'), {
      ok: true,
      value: { type: "object", properties: {} },
    });
  });

  test("refuses text that isn't JSON, with the parser's reason", () => {
    const result = parseSchema('{ "type": ');
    assert.equal(result.ok, false);
    assert.match(!result.ok ? result.message : "", /^Not valid JSON: ./);
  });

  for (const text of ["[]", "true", "null", '"object"', "3"]) {
    test(`refuses ${text}, which isn't an object`, () => {
      assert.deepEqual(parseSchema(text), { ok: false, message: "A schema must be a JSON object." });
    });
  }
});
