// The images a surface has, told as the engine resolves it and without drawing it.
import { isComponentNode, NodeResolver, peekValue, ResolvedBinding, type ComponentNode } from "@a2ui/web_core/v1_0";
import { imageTarget, markdownImageTarget, type ImageTarget } from "../imageTarget.ts";
import { blockTokens, imageOf } from "./markdown/parse.ts";
import type { EngineSurface } from "./engine.ts";

const valueOf = (prop: unknown): unknown => (prop instanceof ResolvedBinding ? prop.value : prop);

/** The images a component draws itself. Inside a button Markdown draws none. */
function ownImages({ type }: ComponentNode, props: Record<string, unknown>, insideButton: boolean): ImageTarget[] {
  if (type === "Image") {
    const url = valueOf(props.url);
    return [imageTarget(typeof url === "string" ? url : "")];
  }
  const text = type === "Text" && !insideButton ? valueOf(props.text) : null;
  if (typeof text !== "string" || !text.includes("![")) return [];
  const tokens = blockTokens(text) ?? [];
  return tokens.filter((token) => token.type === "image").map((token) => markdownImageTarget(imageOf(token).src));
}

/** The components `value` holds, in lists and objects too. */
function nodesIn(value: unknown): ComponentNode[] {
  if (isComponentNode(value)) return [value];
  if (typeof value !== "object" || value === null || value instanceof ResolvedBinding) return [];
  return Object.values(value).flatMap(nodesIn);
}

function imagesUnder(node: ComponentNode, insideButton: boolean): ImageTarget[] {
  const props = peekValue(node.props);
  const inside = insideButton || node.type === "Button";
  return [...ownImages(node, props, insideButton), ...nodesIn(props).flatMap((child) => imagesUnder(child, inside))];
}

/** How many images `surface` has, and the paths of those that are files, each once, in the order the surface has them. */
export function namedImages(surface: EngineSurface): { images: number; image_paths: string[] } {
  const resolver = new NodeResolver(surface);
  try {
    const root = peekValue(resolver.rootNode);
    const targets = root ? imagesUnder(root, false) : [];
    return { images: targets.length, image_paths: [...new Set(targets.flatMap((target) => ("path" in target ? [target.path] : [])))] };
  } finally {
    resolver.dispose();
  }
}
