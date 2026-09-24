# Kanban Board - Design Document

A drag-and-drop Kanban board built with Stax.

## Data Model

Using `Signal.Struct` for reactive card properties and a `status` field for column assignment:

```typescript
type Status = "todo" | "in-progress" | "done";

// Card uses Signal.Struct for reactive fields
type Card = Signal.Struct<{
  id: string;
  title: string;
  description: string;
  priority: "low" | "medium" | "high" | null;
  status: Status;
}>;

// Column definitions (static, not reactive)
interface Column {
  id: Status;
  title: string;
}

const columns: Column[] = [
  { id: "todo", title: "To Do" },
  { id: "in-progress", title: "In Progress" },
  { id: "done", title: "Done" },
];
```

### Benefits of This Approach

1. **Single source of truth** - All cards in one array, status determines which column
2. **Simple moves** - Moving a card is just `card.status.set("done")`
3. **Reactive updates** - Changing any card field (title, priority) updates UI automatically
4. **Easy filtering** - Columns just filter by status with `Readable.map`

## KanbanService (State Context)

All state lives in a service that components access via context:

```typescript
import { Context, Effect } from "effect";
import { Signal } from "@stax-ui/core";

export class KanbanService extends Context.Tag("KanbanService")<
  KanbanService,
  {
    // All cards
    readonly cards: Signal.Array<Card>;
    // Currently dragging
    readonly dragState: Signal<{ cardId: string } | null>;
    // Column being hovered during drag
    readonly hoverColumnId: Signal<Status | null>;
    // Card open in detail dialog
    readonly selectedCard: Signal<Card | null>;

    // Actions
    readonly moveCard: (cardId: string, targetStatus: Status) => Effect.Effect<void>;
    readonly addCard: (title: string, status: Status) => Effect.Effect<void>;
    readonly deleteCard: (cardId: string) => Effect.Effect<void>;
  }
>() {}

// Creates the service value (called once in App)
export const makeKanbanService = () =>
  Effect.gen(function* () {
    const cards = yield* Signal.Array.make<Card>([]);
    const dragState = yield* Signal.make<{ cardId: string } | null>(null);
    const hoverColumnId = yield* Signal.make<Status | null>(null);
    const selectedCard = yield* Signal.make<Card | null>(null);

    // Initialize with sample data
    yield* initializeCards(cards);

    const moveCard = (cardId: string, targetStatus: Status) =>
      Effect.gen(function* () {
        const allCards = yield* cards.get;
        const card = allCards.find((c) => Effect.runSync(c.id.get) === cardId);
        if (card) {
          yield* card.status.set(targetStatus);
        }
      });

    const addCard = (title: string, status: Status) =>
      Effect.gen(function* () {
        const newCard = yield* Signal.Struct.make({
          id: crypto.randomUUID(),
          title,
          description: "",
          priority: null as "low" | "medium" | "high" | null,
          status,
        });
        yield* cards.push(newCard);
      });

    const deleteCard = (cardId: string) =>
      cards.update((arr) => arr.filter((c) => Effect.runSync(c.id.get) !== cardId));

    return {
      cards,
      dragState,
      hoverColumnId,
      selectedCard,
      moveCard,
      addCard,
      deleteCard,
    };
  });

const initializeCards = (cards: Signal.Array<Card>) =>
  Effect.gen(function* () {
    const add = (
      id: string,
      title: string,
      status: Status,
      priority: "low" | "medium" | "high" | null = null,
    ) =>
      Effect.gen(function* () {
        const card = yield* Signal.Struct.make({
          id,
          title,
          description: "",
          priority,
          status,
        });
        yield* cards.push(card);
      });

    yield* add("1", "Research competitors", "todo", "high");
    yield* add("2", "Write project brief", "todo", "medium");
    yield* add("3", "Create wireframes", "todo");
    yield* add("4", "Design landing page", "in-progress", "high");
    yield* add("5", "Set up CI/CD pipeline", "in-progress");
    yield* add("6", "Initial project setup", "done");
    yield* add("7", "Configure development environment", "done");
  });
```

## Component Structure

```
App
├── KanbanBoard
│   ├── Column (repeated via static map, not `each`)
│   │   ├── ColumnHeader
│   │   ├── CardList (drop zone)
│   │   │   └── Card (repeated via `each` + filter, draggable)
│   │   └── AddCardButton
└── AddCardModal (or inline form)
```

## Drag and Drop Implementation

### Key Insight
Stax event handlers are called synchronously - only the returned Effect runs async. This means `e.preventDefault()` and `e.dataTransfer.setData()` work correctly.

### Drag State Management

```typescript
// In KanbanBoard component
const dragState = yield* Signal.make<{
  cardId: string;
} | null>(null);

// Track which column is being hovered (for visual feedback)
const hoverColumnId = yield* Signal.make<Status | null>(null);
```

### Card Component (Draggable)

```typescript
const CardComponent = (props: { card: Readable<Card> }) =>
  Effect.gen(function* () {
    const kanban = yield* KanbanService;
    const card = yield* props.card.get;
    const id = yield* card.id.get;
    const title = card.title;
    const priority = card.priority;

    const isDragging = Readable.map(kanban.dragState, (s) => s?.cardId === id);

    return yield* $.div(
      {
        draggable: "true",
        class: Readable.map(isDragging, (d) =>
          d ? "opacity-50 card bg-base-100 shadow cursor-grab" : "card bg-base-100 shadow cursor-grab"
        ),

        onClick: (e) => {
          // Don't open dialog if dragging
          if (e.defaultPrevented) return Effect.void;
          return kanban.selectedCard.set(card);
        },

        onDragStart: (e) => {
          e.dataTransfer!.setData("text/plain", id);
          e.dataTransfer!.effectAllowed = "move";
          return kanban.dragState.set({ cardId: id });
        },

        onDragEnd: () => kanban.dragState.set(null),
      },
      $.div(
        { class: "card-body p-3" },
        $.h3({ class: "font-medium" }, title),
        when(Readable.map(priority, (p) => p !== null), {
          onTrue: () => PriorityBadge({ priority }),
          onFalse: () => $.span({}, ""),
        }),
      ),
    );
  });
```

### Column Component (Drop Zone)

```typescript
const ColumnComponent = (props: { column: Column }) =>
  Effect.gen(function* () {
    const kanban = yield* KanbanService;
    const { column } = props;

    // Filter cards for this column reactively
    const columnCards = Readable.map(kanban.cards, (cards) =>
      cards.filter((card) => Effect.runSync(card.status.get) === column.id),
    );

    const isHovered = Readable.map(kanban.hoverColumnId, (id) => id === column.id);

    const showDropIndicator = Readable.zipWith(
      kanban.dragState,
      isHovered,
      (drag, hover) => drag !== null && hover,
    );

    return yield* $.div(
      {
        class: Readable.map(showDropIndicator, (show) =>
          show
            ? "bg-base-200 border-2 border-dashed border-primary rounded-lg p-4 min-h-96 w-80"
            : "bg-base-200 rounded-lg p-4 min-h-96 w-80",
        ),

        onDragOver: (e) => {
          e.preventDefault();
          return kanban.hoverColumnId.set(column.id);
        },

        onDragLeave: (e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            return kanban.hoverColumnId.set(null);
          }
          return Effect.void;
        },

        onDrop: (e) =>
          Effect.gen(function* () {
            e.preventDefault();
            const cardId = e.dataTransfer?.getData("text/plain");
            if (cardId) {
              yield* kanban.moveCard(cardId, column.id);
            }
            yield* kanban.hoverColumnId.set(null);
          }),
      },
      $.h2({ class: "font-bold text-lg mb-4" }, column.title),
      each(columnCards, {
        key: (card) => Effect.runSync(card.id.get),
        container: () => $.div({ class: "space-y-2" }),
        render: (card) => CardComponent({ card }),
      }),
      AddCardForm({ status: column.id }),
    );
  });
```

## Add Card Form (with Form Package)

```typescript
// Simple form for adding a new card
const NewCardForm = Form.make({
  title: Field.make(Schema.String.pipe(Schema.minLength(1)), {
    validateOn: "submit",
  }),
});

const AddCardForm = (props: { status: Status }) =>
  Effect.gen(function* () {
    const kanban = yield* KanbanService;
    const isOpen = yield* Signal.make(false);

    return yield* $.div(
      { class: "mt-2" },
      when(isOpen, {
        onTrue: () =>
          // Redraw to reset form each time it opens
          redraw(isOpen, {
            key: () => crypto.randomUUID(), // New key each open = fresh form
            render: () =>
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
                    const hasError = Readable.map(titleField.errors, (e) => e.length > 0);

                    return yield* $.input({
                      class: Readable.map(hasError, (err) =>
                        err
                          ? "input input-bordered input-error w-full input-sm"
                          : "input input-bordered w-full input-sm",
                      ),
                      placeholder: "Card title...",
                      value: titleField.value,
                      onInput: (e) => titleField.set((e.target as HTMLInputElement).value),
                    });
                  }),
                  $.div(
                    { class: "flex gap-2" },
                    $.button(
                      { type: "submit", class: "btn btn-primary btn-sm" },
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
          }),
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
```

## KanbanBoard Component

```typescript
const KanbanBoard = () =>
  Effect.gen(function* () {
    return yield* $.div(
      { class: "flex gap-4 p-4 overflow-x-auto min-h-screen" },
      ...columns.map((column) => ColumnComponent({ column })),
    );
  });
```

## App Entry Point

```typescript
import { provide, runApp } from "@stax-ui/dom";

const App = () =>
  Effect.gen(function* () {
    const kanbanService = yield* makeKanbanService();

    // `provide` wraps a single child, so `collect` is still the way to
    // supply more than one — the element factories are variadic, but
    // provide takes one `Effect<A, E, R>` and preserves its shape.
    return yield* provide(
      KanbanService,
      kanbanService,
      $.div(
        { class: "min-h-screen bg-base-300" },
        KanbanBoard(),
        CardDetailDialog(), // Dialog lives at root level for Portal
      ),
    );
  });

// In main.ts
runApp(App(), document.getElementById("app")!);
```

## Animations

Reuse the animation pattern from todo-app for card enter/exit:

```css
.card-wrapper {
  display: grid;
  grid-template-rows: 1fr;
}

.card-inner {
  overflow: hidden;
  min-height: 0;
}

.card-enter-active {
  grid-template-rows: 1fr;
  opacity: 1;
  transition: grid-template-rows 200ms ease-out, opacity 200ms ease-out;
}

.card-enter-active.card-enter {
  grid-template-rows: 0fr;
  opacity: 0;
}

.card-exit-active {
  grid-template-rows: 1fr;
  opacity: 1;
  transition: grid-template-rows 200ms ease-out, opacity 200ms ease-out;
}

.card-exit-active.card-exit-to {
  grid-template-rows: 0fr;
  opacity: 0;
}
```

## Card Detail Dialog (with Form Package)

Define a form for editing card details:

```typescript
import { Form, Field } from "@stax-ui/form";
import { Schema } from "effect";

// Form definition for editing a card
const CardEditForm = Form.make({
  title: Field.make(Schema.String.pipe(Schema.minLength(1)), {
    validateOn: "blur",
  }),
  description: Field.make(Schema.String),
  priority: Field.make(
    Schema.NullOr(Schema.Literal("low", "medium", "high")),
  ),
});
```

The dialog component uses the form:

```typescript
const CardDetailDialog = () =>
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

    return yield* when(isOpen, {
      onTrue: () =>
        // Redraw form when selected card changes (new defaults)
        redraw(kanban.selectedCard, {
          key: (c) => (c ? Effect.runSync(c.id.get) : "none"),
          render: () => CardEditFormContent({ handleClose, handleDelete }),
        }),
      onFalse: () => $.span({}, $.of("")),
    });
  });

const CardEditFormContent = (props: {
  handleClose: () => Effect.Effect<void>;
  handleDelete: () => Effect.Effect<void>;
}) =>
  Effect.gen(function* () {
    const kanban = yield* KanbanService;
    const card = yield* kanban.selectedCard.get;
    if (!card) return yield* $.span({}, $.of(""));

    // Read current card values for form defaults
    const currentTitle = yield* card.title.get;
    const currentDescription = yield* card.description.get;
    const currentPriority = yield* card.priority.get;

    const handleSubmit = (ctx: { decoded: { title: string; description: string; priority: string | null } }) =>
      Effect.gen(function* () {
        yield* card.title.set(ctx.decoded.title);
        yield* card.description.set(ctx.decoded.description);
        yield* card.priority.set(ctx.decoded.priority as "low" | "medium" | "high" | null);
        yield* kanban.selectedCard.set(null);
      });

    return yield* Portal(() =>
      $.div(
        {
          class: "modal modal-open",
          onClick: (e) => {
            if (e.target === e.currentTarget) return props.handleClose();
            return Effect.void;
          },
        },
        CardEditForm.provide(
          {
            defaults: {
              title: currentTitle,
              description: currentDescription,
              priority: currentPriority,
            },
            onSubmit: handleSubmit,
          },
          // The first child ($.form) automatically gets onSubmit injected
          $.form(
            { class: "modal-box" },
            // Title field
            Effect.gen(function* () {
              const titleField = yield* CardEditForm.fields.title;
              const hasError = Readable.map(titleField.errors, (e) => e.length > 0);

              return yield* $.div(
                { class: "form-control mb-4" },
                $.label({ class: "label" }, $.span({ class: "label-text" }, "Title")),
                $.input({
                  class: Readable.map(hasError, (err) =>
                    err ? "input input-bordered input-error w-full" : "input input-bordered w-full",
                  ),
                  value: titleField.value,
                  onInput: (e) => titleField.set((e.target as HTMLInputElement).value),
                  onBlur: () => titleField.blur(),
                }),
                when(hasError, {
                  onTrue: () =>
                    $.span({ class: "label-text-alt text-error mt-1" }, "Title is required"),
                  onFalse: () => $.span({}, ""),
                }),
              );
            }),

            // Description field
            Effect.gen(function* () {
              const descField = yield* CardEditForm.fields.description;

              return yield* $.div(
                { class: "form-control mb-4" },
                $.label({ class: "label" }, $.span({ class: "label-text" }, "Description")),
                $.textarea({
                  class: "textarea textarea-bordered w-full h-24",
                  placeholder: "Add a description...",
                  value: descField.value,
                  onInput: (e) => descField.set((e.target as HTMLTextAreaElement).value),
                }),
              );
            }),

            // Priority field
            Effect.gen(function* () {
              const priorityField = yield* CardEditForm.fields.priority;

              return yield* $.div(
                { class: "form-control mb-4" },
                $.label({ class: "label" }, $.span({ class: "label-text" }, "Priority")),
                $.select(
                  {
                    class: "select select-bordered w-full",
                    value: Readable.map(priorityField.value, (v) => v ?? ""),
                    onChange: (e) => {
                      const val = (e.target as HTMLSelectElement).value;
                      return priorityField.set(val === "" ? null : (val as "low" | "medium" | "high"));
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
                  onClick: () => props.handleDelete(),
                },
                "Delete",
              ),
              $.div(
                { class: "flex gap-2" },
                $.button(
                  {
                    type: "button",
                    class: "btn btn-ghost",
                    onClick: () => props.handleClose(),
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
        ),
      ),
    );
  });
```

Key form patterns:
- `Form.make({ fields... })` defines the form schema with validation
- `CardEditForm.provide({ defaults, onSubmit }, children)` creates form state and provides context
- `yield* CardEditForm.fields.title` accesses field state inside the form
- Field state has `.value` (Signal), `.errors`, `.touched`, `.dirty` (Readables)
- Field state has `.set()`, `.blur()`, `.focus()`, `.reset()` methods
- The first child element ($.form) automatically receives `onSubmit` handler

## Styling

Using DaisyUI with dark theme:

```html
<!-- In index.html -->
<html data-theme="dark">
```

```typescript
// tailwind.config.js
export default {
  content: ["./src/**/*.{ts,tsx}"],
  plugins: [require("daisyui")],
  daisyui: {
    themes: ["dark"],
  },
};
```

## Potential Enhancements (If Time Permits)

- Reordering cards within a column (more complex drop logic)
- Card priority badges with colors
- Delete card button
- Edit card title inline (easy with Signal.Struct!)
- Persist to localStorage
