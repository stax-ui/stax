import { Effect } from "effect";

import { $, Readable } from "@stax-ui/dom";

export interface Todo {
  id: number;
  text: string;
  completed: boolean;
}

export interface TodoItemProps {
  todo: Readable.Readable<Todo>;
  onToggle: (id: number) => Effect.Effect<void>;
  onDelete: (id: number) => Effect.Effect<void>;
}

// Todo item component
export const TodoItem = (props: TodoItemProps) =>
  Effect.gen(function* () {
    const completed = Readable.map(props.todo, (t) => t.completed);
    const text = Readable.map(props.todo, (t) => t.text);
    const id = Readable.map(props.todo, (t) => t.id);

    const textClass = Readable.map(completed, (c) =>
      c ? "flex-1 line-through opacity-50" : "flex-1",
    );

    // Outer div receives animation classes (display: grid, grid-template-rows)
    // Base class keeps grid layout between animations to prevent jitter
    // Inner div needs overflow:hidden + min-height:0 for grid collapse trick
    return yield* $.div(
      { class: "grid grid-rows-[1fr]" },
      $.div(
        {
          class: "rounded-lg hover:bg-base-200 group overflow-hidden min-h-0",
        },
        $.div(
          { class: "flex items-center gap-2 p-2" },
          $.input({
            class: "checkbox checkbox-primary",
            type: "checkbox",
            checked: completed,
            onChange: () =>
              Effect.gen(function* () {
                const todoId = yield* id.get;
                yield* props.onToggle(todoId);
              }),
          }),
          $.span({ class: textClass }, text),
          $.button(
            {
              class: "btn btn-ghost btn-xs opacity-0 group-hover:opacity-100",
              onClick: () =>
                Effect.gen(function* () {
                  const todoId = yield* id.get;
                  yield* props.onDelete(todoId);
                }),
            },
            "✕",
          ),
        ),
      ),
    );
  });
