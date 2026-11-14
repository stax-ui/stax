import js from "@eslint/js";
import json from "@eslint/json";
import markdown from "@eslint/markdown";
import eslintPluginPrettierRecommended from "eslint-plugin-prettier/recommended";
import { defineConfig } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

import stax from "./scripts/eslint/index.js";

export default defineConfig([
  {
    ignores: ["coverage/**", "public/**", "dist/**", "pnpm-lock.yaml"],
  },
  {
    files: ["**/*.{js,mjs,cjs,ts,mts,cts}"],
    plugins: { js },
    extends: ["js/recommended"],
    languageOptions: { globals: globals.browser },
  },
  tseslint.configs.recommended,
  {
    files: ["**/*.{ts,mts,cts,js,mjs,cjs}"],
    plugins: { stax },
    rules: {
      "stax/no-empty-element-props": "error",
    },
  },
  {
    files: ["**/*.{ts,mts,cts}"],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-namespace": "off",
    },
  },
  {
    files: ["**/*.json"],
    ignores: ["**/tsconfig*.json"],
    plugins: { json },
    language: "json/json",
    extends: ["json/recommended"],
  },
  // Markdown: lint the text as GFM, then also run our $-factory rule
  // against the ```ts / ```tsx / ```js code blocks inside each file.
  {
    files: ["**/*.md"],
    plugins: { markdown },
    language: "markdown/gfm",
    processor: "markdown/markdown",
  },
  {
    files: ["**/*.md/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}"],
    plugins: { stax },
    rules: {
      "stax/no-empty-element-props": "error",
      // Docs snippets are illustrative — they're not expected to be
      // self-contained programs, so turn off the noise that fires on
      // every example's `import` / unused binding / missing global /
      // bare expression (a lot of snippets are a single `yield* X()`).
      "no-unused-vars": "off",
      "no-undef": "off",
      "no-unused-expressions": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-unused-expressions": "off",
    },
  },
  eslintPluginPrettierRecommended,
]);
