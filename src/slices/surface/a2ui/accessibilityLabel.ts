import { hasOwn, isObject } from "../json.ts";

/** The label of a component's `@accessibility`, once its `props` are evaluated; empty when it has none. */
export function accessibilityLabel(props: object): string {
  const accessibility: unknown = isObject(props) && hasOwn(props, "@accessibility") ? props["@accessibility"] : null;
  if (!isObject(accessibility) || !hasOwn(accessibility, "label")) return "";
  return typeof accessibility.label === "string" ? accessibility.label.trim() : "";
}
