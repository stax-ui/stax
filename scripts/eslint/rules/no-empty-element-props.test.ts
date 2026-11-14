import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";
import { describe, it } from "vitest";

import rule from "./no-empty-element-props.js";

const tsParser = tseslint.parser;

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({
  languageOptions: {
    parser: tsParser,
    ecmaVersion: "latest",
    sourceType: "module",
  },
});

tester.run("no-empty-element-props", rule, {
  valid: [
    // Non-empty props are fine.
    `$.span({ class: "x" }, "hi");`,
    // Plain call with no args.
    `$.span();`,
    // Children-only call.
    `$.span("hi");`,
    // A different callee, not `$`.
    `other.span({}, "hi");`,
    // Spread-only "object" is not empty.
    `$.span({ ...maybe }, "hi");`,
    // A variable bound to {} isn't inline — rule only catches ObjectExpression.
    `const p = {}; $.span(p, "hi");`,
    // Doc comment with prose that isn't an @example block should NOT fire.
    `
    /**
     * Don't write \`$.span({}, "hi")\` — write \`$.span("hi")\`.
     */
    const x = 1;
    `,
    // @example block with a correct snippet.
    `
    /**
     * @example
     * $.span("hi");
     */
    const x = 1;
    `,
  ],
  invalid: [
    {
      code: `$.span({}, "hi");`,
      output: `$.span("hi");`,
      errors: [{ messageId: "empty" }],
    },
    {
      code: `$.div({}, a, b);`,
      output: `$.div(a, b);`,
      errors: [{ messageId: "empty" }],
    },
    {
      code: `$.div({});`,
      output: `$.div();`,
      errors: [{ messageId: "empty" }],
    },
    {
      code: `yield* $.span({}, "hi");`,
      output: `yield* $.span("hi");`,
      errors: [{ messageId: "empty" }],
      languageOptions: {
        parser: tsParser,
        ecmaVersion: "latest",
        sourceType: "module",
        parserOptions: { ecmaFeatures: { jsx: false } },
      },
    },
    // Multi-line call — fixer should handle the newline between {} and next arg.
    {
      code: `$.div(\n  {},\n  child,\n);`,
      output: `$.div(\n  child,\n);`,
      errors: [{ messageId: "empty" }],
    },
    // Doc-comment @example — reports, no fix.
    {
      code: `
/**
 * @example
 * $.span({}, "hi")
 */
const x = 1;
`,
      errors: [{ messageId: "emptyInComment" }],
    },
    // Doc-comment @example with multiple empty-props calls — one report each.
    {
      code: `
/**
 * @example
 * $.div({}, $.span({}, "hi"))
 */
const x = 1;
`,
      errors: [
        { messageId: "emptyInComment" },
        { messageId: "emptyInComment" },
      ],
    },
    // Doc-comment prose before @example should NOT fire, but the example itself should.
    {
      code: `
/**
 * Prefer \`$.span("hi")\` over \`$.span({}, "hi")\`.
 *
 * @example
 * $.p({}, "hi")
 */
const x = 1;
`,
      errors: [{ messageId: "emptyInComment" }],
    },
    // Regression: @-prefixed package names (e.g. @stax-ui/dom) inside the
    // example body must not truncate the example section early.
    {
      code: `
/**
 * @deprecated use \`foo\` instead
 * @example
 * \`\`\`ts
 * import { $ } from "@stax-ui/dom"
 * $.div({}, "hi")
 * \`\`\`
 */
const x = 1;
`,
      errors: [{ messageId: "emptyInComment" }],
    },
  ],
});
