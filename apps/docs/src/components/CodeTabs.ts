import { Effect } from "effect";

import { $, match, Readable, Signal } from "@stax-ui/dom";

export interface CodeFile {
  readonly filename: string;
  /** Shiki-rendered HTML for this file. */
  readonly html: string;
}

/**
 * Tabbed code viewer. All files render up front; a `Signal<string>`
 * tracks the active filename, and inactive panels get
 * `data-active="false"` (CSS in styles.css hides them). Keeps things
 * SSR-friendly — no reactive `when`/`match` in the tree, just an
 * attribute driven by the signal.
 */
export const CodeTabs = (props: {
  readonly files: readonly CodeFile[];
  readonly class?: string;
}) =>
  Effect.gen(function* () {
    if (props.files.length === 0) return yield* $.div();

    const active = yield* Signal.make(props.files[0].filename);

    return yield* $.div(
      {
        class: [
          "rounded-lg overflow-hidden bg-code border grid grid-rows-[auto_1fr]",
          props.class ?? "",
        ],
      },
      // ─── Tab bar ─────────────────────────────────────────────
      $.div(
        {
          class: ["flex overflow-x-auto scrollbar-none", "border-b"],
        },
        props.files.map((file) =>
          $.button(
            {
              type: "button",
              class: [
                "px-4 py-2 text-caption-2 font-mono cursor-pointer",
                "text-base-content/60 hover:text-base-content",
                "border-r whitespace-nowrap transition-colors",
                // Active tab: primary text + accent underline via a
                // pseudo-border. Driven by the `data-active` attribute
                // synced from the `active` signal.
                "data-[active=true]:text-primary data-[active=true]:bg-base-100",
                "data-[active=true]:font-semibold",
              ],
              "data-active": Readable.map(active, (a) => a === file.filename),
              onClick: () => active.set(file.filename),
            },
            file.filename,
          ),
        ),
      ),
      // ─── Panels ──────────────────────────────────────────────
      match(active, {
        container: () =>
          $.div({ class: "relative overflow-hidden flex flex-col" }),
        cases: props.files.map((file) => ({
          pattern: file.filename,
          render: () =>
            $.div({
              class: [
                "overflow-hidden flex-1 flex flex-col [&_pre]:!border-none [&_pre]:!rounded-none",
              ],
              "data-active": Readable.map(active, (a) =>
                a === file.filename ? "true" : "false",
              ),
              innerHTML: file.html,
            }),
        })),
        animate: {
          enterFrom: "!opacity-0",
          enter: "transition-opacity duration-200",
          enterTo: "opacity-100",
          exit: "transition-opacity duration-200",
          exitTo: "!opacity-0 absolute inset-0",
        },
      }),
    );
  });
