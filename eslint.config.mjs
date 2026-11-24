import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import jsxA11y from "eslint-plugin-jsx-a11y";
import unusedImports from "eslint-plugin-unused-imports";
import globals from "globals";

// The boundary between agent surfaces and Quay's own cards, as restrictions on what a module may
// import, whichever syntax imports it. A later block's restrictions replace an earlier block's, so
// each block below lists all of its own. The fixtures are in src/importBoundary.test.ts.

/** No import whose specifier matches the regular expression `specifier`. A slash in it is its Unicode escape, as a selector's regular expression takes no bare one. */
const noImport = (specifier, message) => ({
  selector:
    ":matches(ImportDeclaration, ExportNamedDeclaration, ExportAllDeclaration, ImportExpression, TSImportType, TSExternalModuleReference, CallExpression[callee.name='require'])" +
    ` > :matches(Literal[value=/${specifier}/], TemplateLiteral:has(> TemplateElement[value.raw=/${specifier}/]))`,
  message,
});

const A2UI_PACKAGE = "^@a2ui(\\u002F|$)";
const A2UI_MODULE = "(^|\\u002F)surface\\u002Fa2ui(\\u002F|$)";
const CARDS = "^\\..*\\u002Fcards(\\u002F|$)";

const noA2uiPackage = noImport(A2UI_PACKAGE, "Only the A2UI module (src/slices/surface/a2ui) may import @a2ui.");
const BENEATH_BOTH = "The parts are under the A2UI module's components and Quay's cards, and may import neither.";

export default [
  {
    ignores: ["dist/**", "src-tauri/**", "docs/**", "scripts/**", "examples/**", "tools/**", "node_modules/**"],
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin,
      "react-hooks": reactHooks,
      "jsx-a11y": jsxA11y,
      "unused-imports": unusedImports,
    },
    rules: {
      ...jsxA11y.flatConfigs.recommended.rules,
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "unused-imports/no-unused-imports": "error",
      "unused-imports/no-unused-vars": [
        "error",
        {
          vars: "all",
          varsIgnorePattern: "^_",
          args: "after-used",
          argsIgnorePattern: "^_",
          caughtErrors: "all",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/slices/surface/a2ui/**"],
    rules: { "no-restricted-syntax": ["error", noA2uiPackage] },
  },
  {
    files: ["src/slices/cards/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        noA2uiPackage,
        noImport(A2UI_MODULE, "Quay's cards may not import the A2UI module: no agent content reaches a path that acts."),
      ],
    },
  },
  {
    files: ["src/slices/parts/**"],
    rules: {
      "no-restricted-syntax": ["error", noA2uiPackage, noImport(A2UI_MODULE, BENEATH_BOTH), noImport(CARDS, BENEATH_BOTH)],
    },
  },
  {
    files: ["src/slices/surface/a2ui/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        noImport(CARDS, "The A2UI module may not import the card shell: no agent surface may carry the Quay mark."),
      ],
    },
  },
];
