import { Effect, Schema } from "effect";

import { $, Readable, Signal, when } from "@stax-ui/dom";
import { Field, Form } from "@stax-ui/form";

import { KanbanService } from "../services/KanbanService.js";
import type { Status } from "../types.js";

const NewCardForm = Form.make({
  title: Field.make(Schema.String.pipe(Schema.minLength(1)), {
    validateOn: "submit",
  }),
});

export const AddCardForm = (props: { status: Status }) =>
  Effect.gen(function* () {
    const kanban = yield* KanbanService;
    const isOpen = yield* Signal.make(false);

    return yield* $.div(
      { class: "mt-3" },
      when(isOpen, {
        onTrue: () =>
          NewCardForm.provide(
            {
              defaults: { title: "" },
              onSubmit: (ctx) =>
                Effect.gen(function* () {
                  yield* kanban.addCard(ctx.decoded.title.trim(), props.status);
                  yield* isOpen.set(false);
                }),
            },
            $.form(
              { class: "space-y-2" },
              Effect.gen(function* () {
                const titleField = yield* NewCardForm.fields.title;
                const hasError = Readable.map(
                  titleField.errors,
                  (e) => e.length > 0,
                );

                return yield* $.input({
                  class: Readable.map(hasError, (err) =>
                    err
                      ? "input input-bordered input-error w-full input-sm"
                      : "input input-bordered w-full input-sm",
                  ),
                  placeholder: "Card title...",
                  value: titleField.value,
                  onInput: (e) =>
                    titleField.set((e.target as HTMLInputElement).value),
                });
              }),
              $.div(
                { class: "flex gap-2" },
                $.button(
                  {
                    type: "submit",
                    class: "btn btn-primary btn-sm",
                  },
                  "Add",
                ),
                $.button(
                  {
                    type: "button",
                    class: "btn btn-ghost btn-sm",
                    onClick: () => isOpen.set(false),
                  },
                  "Cancel",
                ),
              ),
            ),
          ),
        onFalse: () =>
          $.button(
            {
              class: "btn btn-ghost btn-sm w-full",
              onClick: () => isOpen.set(true),
            },
            "+ Add card",
          ),
      }),
    );
  });
