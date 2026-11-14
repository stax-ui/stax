import type { Rule, SourceCode } from "eslint";

type ESLintComment = SourceCode["ast"]["comments"][number];

type NodeWithRange = { type: string; range: [number, number] };
type EmptyObjectNode = NodeWithRange & {
  type: "ObjectExpression";
  properties: unknown[];
};

const isEmptyObjectExpression = (node: unknown): node is EmptyObjectNode => {
  if (!node || typeof node !== "object") return false;
  const n = node as {
    type?: string;
    properties?: unknown[];
    range?: unknown;
  };
  return (
    n.type === "ObjectExpression" &&
    (n.properties?.length ?? 0) === 0 &&
    Array.isArray(n.range)
  );
};

const EXAMPLE_PATTERN = /\$\.(\w+)\(\s*\{\s*\}\s*(?:,|\))/g;

const rule: Rule.RuleModule = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Disallow passing an empty props object to $-factory calls — write `$.span('hi')` instead of `$.span({}, 'hi')`.",
    },
    fixable: "code",
    schema: [],
    messages: {
      empty:
        "Omit the empty props object: write `$.{{tag}}({{suffix}})` instead of `$.{{tag}}({}{{commaSuffix}})`.",
      emptyInComment:
        "Doc example shows `$.{{tag}}({}, ...)`. Write `$.{{tag}}(...)` with no empty props.",
    },
  },

  create(context) {
    const source = context.sourceCode;

    return {
      CallExpression(node) {
        const callee = node.callee;
        if (
          callee.type !== "MemberExpression" ||
          callee.computed ||
          callee.object.type !== "Identifier" ||
          callee.object.name !== "$" ||
          callee.property.type !== "Identifier"
        ) {
          return;
        }

        const first = node.arguments[0];
        const rest = node.arguments.slice(1);
        if (!isEmptyObjectExpression(first)) return;

        const tag = callee.property.name;
        const hasRest = rest.length > 0;

        context.report({
          node: first,
          messageId: "empty",
          data: {
            tag,
            suffix: hasRest ? "…children" : "",
            commaSuffix: hasRest ? ", …" : "",
          },
          fix(fixer) {
            if (!hasRest) {
              return fixer.remove(first);
            }
            // Drop `{}` and everything up to the next arg — including the
            // comma and any whitespace/newlines between them.
            const nextStart = (rest[0] as unknown as NodeWithRange).range[0];
            return fixer.removeRange([first.range[0], nextStart]);
          },
        });
      },

      "Program:exit"() {
        for (const comment of source.getAllComments()) {
          reportEmptyPropsInDocComment(context, comment);
        }
      },
    };
  },
};

function reportEmptyPropsInDocComment(
  context: Rule.RuleContext,
  comment: ESLintComment,
): void {
  if (comment.type !== "Block") return;
  if (!comment.value.startsWith("*")) return;
  if (!comment.value.includes("@example")) return;

  // Pull out each `@example ... (next @tag | end)` section and check
  // each one for the pattern. Walking sections (not whole comment)
  // keeps prose like `don't write $.span({}, …)` elsewhere in the
  // doc comment from tripping the rule.
  for (const section of extractExampleSections(comment.value)) {
    const stripped = section.text.replace(/^\s*\*\s?/gm, "");
    EXAMPLE_PATTERN.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = EXAMPLE_PATTERN.exec(stripped)) !== null) {
      context.report({
        loc: comment.loc ?? {
          start: { line: 1, column: 0 },
          end: { line: 1, column: 0 },
        },
        messageId: "emptyInComment",
        data: { tag: m[1] },
      });
    }
  }
}

function extractExampleSections(commentValue: string): Array<{ text: string }> {
  // JSDoc tags are always line-anchored (`^\s*\*\s*@name`). Matching
  // them line-anchored avoids false positives on `@scope/pkg` inside
  // code (`import { $ } from "@stax-ui/dom"`) or any other `@` buried
  // in the example body.
  const sections: Array<{ text: string }> = [];
  const tagRe = /^\s*\*\s*@(\w+)/gm;
  let inExample = false;
  let sectionStart = 0;
  let match: RegExpExecArray | null;

  while ((match = tagRe.exec(commentValue)) !== null) {
    if (inExample) {
      sections.push({ text: commentValue.slice(sectionStart, match.index) });
    }
    inExample = match[1] === "example";
    if (inExample) sectionStart = tagRe.lastIndex;
  }
  if (inExample) {
    sections.push({ text: commentValue.slice(sectionStart) });
  }
  return sections;
}

export default rule;
