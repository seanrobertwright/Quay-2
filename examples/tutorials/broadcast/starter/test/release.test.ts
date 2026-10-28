import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const changelog = read("CHANGELOG.md");
const headings = [...changelog.matchAll(/^## \[(.+?)\](.*)$/gm)].map(([, name, rest]) => ({ name, rest }));
const versions = headings.filter((heading) => heading.name !== "Unreleased");

test("package.json version matches the newest CHANGELOG version", () => {
  const { version } = JSON.parse(read("package.json")) as { version: string };
  expect(versions[0]?.name).toBe(version);
});

test("CHANGELOG has an Unreleased section above the newest version", () => {
  expect(headings[0]?.name).toBe("Unreleased");
});

test("every CHANGELOG version has a YYYY-MM-DD date", () => {
  for (const { name, rest } of versions) {
    expect(rest, `## [${name}]`).toMatch(/^ - \d{4}-\d{2}-\d{2}$/);
  }
});
