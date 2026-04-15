// Minimal ESLint config for the desktop renderer. Scope is deliberately narrow:
// we only enforce rules that have caught real bugs in this codebase.
//
// Current rules:
// - react-hooks/exhaustive-deps (error) — would've caught the useEventStream
//   reconnect-loop bug (fdf817e) where `connect` was declared outside
//   useEffect but listed in the deps array. Every render created a new
//   `connect` closure, which re-ran the effect and opened a new EventSource.
//
// Deliberately NOT enabled: the usual battery of style/typescript-eslint rules.
// Typescript itself + the compiler already catch most correctness issues;
// adding a broader lint surface here would be noise without a clear prior
// incident to justify it.

import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  {
    ignores: ["dist/**", "dist-electron/**", "node_modules/**", "eslint.config.mjs"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended.map((c) => ({
    ...c,
    files: ["src/**/*.{ts,tsx}", "electron/**/*.ts"],
  })),
  {
    files: ["src/**/*.{ts,tsx}", "electron/**/*.ts"],
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      // The only rules we enforce, for the reasons documented above.
      "react-hooks/exhaustive-deps": "error",
      "react-hooks/rules-of-hooks": "error",

      // Disable noisy defaults from js.configs.recommended + tseslint.configs.recommended.
      // TS/compiler already covers correctness; broader style enforcement is out of scope.
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/no-require-imports": "off",
      "no-empty": "off",
      "no-useless-escape": "off",
      "no-control-regex": "off",
      "no-prototype-builtins": "off",
    },
  },
);
