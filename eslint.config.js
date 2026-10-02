import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import prettier from "eslint-config-prettier";

/**
 * Flat ESLint config for the whole repo (client + server + tests + scripts).
 *
 * Deliberately pragmatic: `tsc` already owns types, so this catches the things
 * the compiler can't — hook rule violations, unused bindings, accidental `any`,
 * and React refresh boundaries. Prettier is last so formatting never shows up
 * as a lint error.
 */
export default tseslint.config(
  { ignores: ["dist", "node_modules", "**/*.tsbuildinfo", "scripts/**", ".tmp/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      // The two rules that actually prevent bugs in this codebase.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      // `any` is a warning, not an error: the ESPN/Understat normalization
      // layer legitimately takes untyped third-party JSON.
      "@typescript-eslint/no-explicit-any": "warn",
      // Honour the existing `_`-prefixed intentionally-unused convention.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  prettier,
);
