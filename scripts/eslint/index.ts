import type { ESLint } from "eslint";

import noEmptyElementProps from "./rules/no-empty-element-props.js";

const plugin: ESLint.Plugin = {
  meta: {
    name: "stax",
    version: "0.0.0",
  },
  rules: {
    "no-empty-element-props": noEmptyElementProps,
  },
};

export default plugin;
