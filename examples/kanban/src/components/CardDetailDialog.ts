import { Effect, Schema } from "effect";

import { $, Portal, Readable, redraw, when } from "@stax-ui/dom";
import { Field, Form } from "@stax-ui/form";

import { KanbanService } from "../services/KanbanService.js";
import type { Priority } from "../types.js";

const CardEditForm = Form.make({
  title: Field.make(Schema.String.pipe(Schema.minLength(1)), {
    validateOn: "blur",
  }),
  description: Field.make(Schema.String),
  priority: Field.make(Schema.NullOr(Schema.Literal("low", "medium", "high"))),
});

export const CardDetailDialog = () =>
  Effect.gen(function* () {
    const kanban = yield* KanbanService;
    const isOpen = Readable.map(kanban.selectedCard, (c) => c !== null);

    const handleClose = () => kanban.selectedCard.set(null);

    const handleDelete = () =>
      Effect.gen(function* () {
        const c = yield* kanban.selectedCard.get;
        if (c) {
          const id = yield* c.id.get;
          yield* kanban.deleteCard(id);
        }
        yield* kanban.selectedCard.set(null);
      });

    const handleSubmit = (ctx: {
      decoded: {
        title: string;
        description: string;
        priority: Priority | null;
      };
    }) =>
      Effect.gen(function* () {
        const card = yield* kanban.selectedCard.get;

        if (!card) return;

        yield* card.title.set(ctx.decoded.title);
        yield* card.description.set(ctx.decoded.description);
        yield* card.priority.set(ctx.decoded.priority);
        yield* kanban.selectedCard.set(null);
      });

    return yield* Portal(() =>
      $.div(
        {
          class: [
            "modal",
            Readable.map(isOpen, (open) => (open ? "modal-open" : "")),
          ],
          onClick: (e) => {
            if (e.target === e.currentTarget) return handleClose();
            return Effect.void;
          },
        },
        redraw(kanban.selectedCard, {
          render: (card) =>
            Effect.gen(function* () {
              if (!card) return yield* $.div();

              return yield* CardEditForm.provide(
                {
                  defaults: {
                    title: yield* card.title.get,
                    description: yield* card.description.get,
                    priority: yield* card.priority.get,
                  },
                  onSubmit: handleSubmit,
                },
                $.form(
                  { class: "modal-box" },
                  // Title field
                  Effect.gen(function* () {
                    const titleField = yield* CardEditForm.fields.title;
                    const hasError = Readable.map(
                      titleField.errors,
                      (e) => e.length > 0,
                    );

                    return yield* $.div(
                      { class: "form-control mb-4" },
                      $.label(
                        { class: "label" },
                        $.span({ class: "label-text" }, "Title"),
                      ),
                      $.input({
                        class: Readable.map(hasError, (err) =>
                          err
                            ? "input input-bordered input-error w-full"
                            : "input input-bordered w-full",
                        ),
                        value: titleField.value,
                        onInput: (e) =>
                          titleField.set((e.target as HTMLInputElement).value),
                        onBlur: () => titleField.blur(),
                      }),
                      when(hasError, {
                        onTrue: () =>
                          $.span(
                            { class: "label-text-alt text-error mt-1" },
                            "Title is required",
                          ),
                        onFalse: () => $.span({}, ""),
                      }),
                    );
                  }),

                  // Description field
                  Effect.gen(function* () {
                    const descField = yield* CardEditForm.fields.description;

                    return yield* $.div(
                      { class: "form-control mb-4" },
                      $.label(
                        { class: "label" },
                        $.span({ class: "label-text" }, "Description"),
                      ),
                      $.textarea({
                        class: "textarea textarea-bordered w-full h-24",
                        placeholder: "Add a description...",
                        value: descField.value,
                        onInput: (e) =>
                          descField.set(
                            (e.target as HTMLTextAreaElement).value,
                          ),
                      }),
                    );
                  }),

                  // Priority field
                  Effect.gen(function* () {
                    const priorityField = yield* CardEditForm.fields.priority;

                    return yield* $.div(
                      { class: "form-control mb-4" },
                      $.label(
                        { class: "label" },
                        $.span({ class: "label-text" }, "Priority"),
                      ),
                      $.select(
                        {
                          class: "select select-bordered w-full",
                          value: Readable.map(
                            priorityField.value,
                            (v) => v ?? "",
                          ),
                          onChange: (e) => {
                            const val = (e.target as HTMLSelectElement).value;
                            return priorityField.set(
                              val === "" ? null : (val as Priority),
                            );
                          },
                        },
                        $.option({ value: "" }, "None"),
                        $.option({ value: "low" }, "Low"),
                        $.option({ value: "medium" }, "Medium"),
                        $.option({ value: "high" }, "High"),
                      ),
                    );
                  }),

                  // Actions
                  $.div(
                    { class: "modal-action justify-between" },
                    $.button(
                      {
                        type: "button",
                        class: "btn btn-error btn-outline",
                        onClick: () => handleDelete(),
                      },
                      "Delete",
                    ),
                    $.div(
                      { class: "flex gap-2" },
                      $.button(
                        {
                          type: "button",
                          class: "btn btn-ghost",
                          onClick: () => handleClose(),
                        },
                        "Cancel",
                      ),
                      $.button(
                        { type: "submit", class: "btn btn-primary" },
                        "Save",
                      ),
                    ),
                  ),
                ),
              );
            }),
        }),
      ),
    );
  });
