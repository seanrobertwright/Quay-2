// Reads the tools Quay's MCP server lists and the A2A page's tool reference, and lists every
// place they disagree, so a parameter name in the docs can't drift from the server again.

/** The tool list Quay's MCP server answers `tools/list` with. */
export const TOOL_LIST = new URL('../../src-tauri/src/slices/orchestrator/mcp_tools.json', import.meta.url);

/** The page whose tool reference must match it. */
export const REFERENCE_PAGE = new URL('../../docs/features/a2a-orchestration.md', import.meta.url);

export interface Parameter {
  name: string;
  /** `string`, `boolean`, `integer`, `number`, or `array of <items>s`. */
  type: string;
  required: boolean;
}

export interface Tool {
  name: string;
  parameters: Parameter[];
}

export interface ReferencedTool {
  name: string;
  /** `null` when the section has no `- **Parameters**:` line. */
  parameters: Parameter[] | null;
  /** Parameter lines the reference holds but this can't read. */
  unreadable?: string[];
  /** Set when the section has more than one `- **Parameters**:` line. */
  repeatedParametersLine?: true;
}

interface PropertySchema {
  type?: unknown;
  items?: { type?: unknown };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parameterType(tool: string, name: string, schema: unknown): string {
  const { type, items } = (isObject(schema) ? schema : {}) as PropertySchema;
  if (type === 'array' && typeof items?.type === 'string') return `array of ${items.type}s`;
  if (typeof type === 'string' && type !== 'array') return type;
  throw new Error(`${tool}: parameter ${name} has no type the reference can name`);
}

/** Parses `mcp_tools.json`, failing on any tool it can't read. */
export function parseToolList(json: string): Tool[] {
  const list: unknown = JSON.parse(json);
  if (!Array.isArray(list)) throw new Error('the tool list is not a JSON array');
  return list.map((tool, index) => {
    if (!isObject(tool) || typeof tool.name !== 'string' || !isObject(tool.inputSchema)) {
      throw new Error(`tool ${index} has no name or inputSchema`);
    }
    const { properties = {}, required = [] } = tool.inputSchema;
    if (!isObject(properties) || !Array.isArray(required)) {
      throw new Error(`${tool.name}: inputSchema has no properties object or required array`);
    }
    const name = tool.name;
    return {
      name,
      parameters: Object.entries(properties).map(([param, schema]) => ({
        name: param,
        type: parameterType(name, param, schema),
        required: required.includes(param),
      })),
    };
  });
}

const TOOL_HEADING = /^### `([A-Za-z0-9_]+)`\s*$/;
const HEADING = /^#{1,6} /;
const PARAMETERS_LINE = /^- \*\*Parameters\*\*:\s*(.*)$/;
const PARAMETER_LINE = /^\s+- `([A-Za-z0-9_]+)` \(([^,()]+), (required|optional)[,)]/;
const FENCE = /^\s*(```|~~~)/;

/**
 * Reads each `### `tool_name`` section of `markdown`: its `- **Parameters**:` line, either
 * `none.` or followed by one indented `- `name` (type, required|optional): ...` line per
 * parameter, up to the first blank or unindented line. Lines indented deeper than the
 * first parameter line, nested lists included, continue a parameter's description. Other
 * headings end a section and are never read as tools, and nothing inside a code fence is
 * read at all.
 */
export function parseToolReference(markdown: string): ReferencedTool[] {
  const tools: ReferencedTool[] = [];
  let current: ReferencedTool | null = null;
  // The indent of the list's parameter lines once its first one is read, `null` outside a list
  let listIndent: number | null = null;
  let fence: string | null = null;
  for (const line of markdown.split(/\r?\n/)) {
    const fenceMark = FENCE.exec(line)?.[1];
    if (fence !== null) {
      if (fenceMark === fence) fence = null;
      continue;
    }
    if (fenceMark) {
      fence = fenceMark;
      continue;
    }
    if (HEADING.test(line)) {
      const name = TOOL_HEADING.exec(line)?.[1];
      current = name ? { name, parameters: null } : null;
      if (current) tools.push(current);
      listIndent = null;
      continue;
    }
    if (!current) continue;
    if (listIndent !== null) {
      const indent = /^\s*/.exec(line)![0].length;
      if (indent > 0 && line.trim() !== '') {
        const isItem = line.trimStart().startsWith('- ');
        // The first item sets the list's indent; anything deeper belongs to a parameter
        if (isItem && (listIndent === -1 || indent === listIndent)) {
          listIndent = indent;
          const match = PARAMETER_LINE.exec(line);
          if (match) {
            current.parameters!.push({ name: match[1], type: match[2].trim(), required: match[3] === 'required' });
          } else {
            (current.unreadable ??= []).push(line);
          }
        }
        continue;
      }
      listIndent = null;
    }
    const parameters = PARAMETERS_LINE.exec(line);
    if (!parameters) continue;
    if (current.parameters !== null) {
      current.repeatedParametersLine = true;
      continue;
    }
    current.parameters = [];
    const rest = parameters[1].trim();
    if (rest === '') listIndent = -1;
    else if (!/^none\.?$/i.test(rest)) (current.unreadable ??= []).push(line);
  }
  return tools;
}

function describe(param: Parameter): string {
  return `${param.type}, ${param.required ? 'required' : 'optional'}`;
}

/**
 * Every disagreement between the server's `tools` and the page's `reference`: those for each
 * server tool in the server's order, then one for each section naming a tool the server lacks.
 */
export function referenceProblems(tools: Tool[], reference: ReferencedTool[]): string[] {
  const problems: string[] = [];
  for (const tool of tools) {
    const sections = reference.filter((section) => section.name === tool.name);
    if (sections.length === 0) {
      problems.push(`\`${tool.name}\` is on the MCP server but has no \`### \`${tool.name}\`\` section`);
      continue;
    }
    if (sections.length > 1) {
      problems.push(`\`${tool.name}\` has ${sections.length} sections; give it one`);
      continue;
    }
    const [section] = sections;
    if (section.parameters === null) {
      problems.push(`\`${tool.name}\`: the section has no \`- **Parameters**:\` line`);
      continue;
    }
    if (section.repeatedParametersLine) {
      problems.push(`\`${tool.name}\`: the section has more than one \`- **Parameters**:\` line; give it one`);
      continue;
    }
    for (const line of section.unreadable ?? []) {
      problems.push(
        `\`${tool.name}\`: cannot read the parameter line "${line}"; write it as "- \`name\` (type, required|optional): ..."`,
      );
    }
    for (const param of tool.parameters) {
      const lines = section.parameters.filter((p) => p.name === param.name);
      const [documented] = lines;
      if (lines.length > 1) {
        problems.push(`\`${tool.name}\`: parameter \`${param.name}\` is documented ${lines.length} times; give it one line`);
      } else if (!documented) {
        problems.push(`\`${tool.name}\`: parameter \`${param.name}\` is missing from the reference`);
      } else if (describe(documented) !== describe(param)) {
        problems.push(
          `\`${tool.name}\`: parameter \`${param.name}\` is ${describe(param)}, but the reference says ${describe(documented)}`,
        );
      }
    }
    for (const documented of section.parameters) {
      if (!tool.parameters.some((p) => p.name === documented.name)) {
        problems.push(`\`${tool.name}\`: parameter \`${documented.name}\` is not in the tool's schema`);
      }
    }
  }
  for (const name of new Set(reference.map((section) => section.name))) {
    if (!tools.some((tool) => tool.name === name)) {
      problems.push(`\`${name}\` has a section but is not on the MCP server`);
    }
  }
  return problems;
}
