import { Effect } from "effect";

import { $, each, Readable, Signal } from "@stax-ui/dom";

export interface StatProps {
  label: string;
  value: Readable.Readable<number>;
}

// Stat component - displays a single statistic using DaisyUI stat styling
export const Stat = (props: StatProps) =>
  Effect.gen(function* () {
    const valueList = yield* Signal.Array.make([0]);

    yield* Readable.tap(props.value, (n) =>
      Effect.gen(function* () {
        yield* valueList.push(n);

        const currSize = yield* valueList.length.get;
        if (currSize > 1) {
          yield* valueList.shift();
        }
      }),
    );

    return yield* $.div(
      { class: "stat place-items-center" },
      $.div({ class: "stat-title" }, props.label),
      $.div(
        { class: "stat-value text-primary h-14 relative" },
        each(valueList, {
          key: (v) => v.toString(),
          render: (v) => $.div({ class: "absolute" }, v),
          animate: {
            enterFrom: "top-1/2 opacity-0",
            enter: "transition-all duration-300",
            enterTo: "opacity-100 top-0",
            exit: "transition-all duration-300",
            exitTo: "!opacity-0 !-top-1/2",
          },
        }),
      ),
    );
  });
