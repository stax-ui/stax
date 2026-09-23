import { Effect } from "effect";

import { $, each, Readable } from "@stax-ui/dom";

import { KanbanService } from "../services/KanbanService.js";
import type { Column as ColumnType } from "../types.js";
import { AddCardForm } from "./AddCardForm.js";
import { Card } from "./Card.js";

export const Column = (props: { column: ColumnType }) =>
  Effect.gen(function* () {
    const kanban = yield* KanbanService;
    const { column } = props;

    // Filter cards for this column reactively
    const columnCards = Readable.map(kanban.cards, (cards) =>
      cards.filter((card) => Effect.runSync(card.status.get) === column.id),
    );

    const isHovered = Readable.map(
      kanban.hoverColumnId,
      (id) => id === column.id,
    );

    const showDropIndicator = Readable.zipWith(
      kanban.dragState,
      isHovered,
      (drag, hover) => drag !== null && hover,
    );

    const columnClass = Readable.map(showDropIndicator, (show) =>
      show
        ? "bg-base-200 border-2 border-dashed border-primary rounded-lg p-4 min-h-96 w-80 flex-shrink-0"
        : "bg-base-200 rounded-lg p-4 min-h-96 w-80 flex-shrink-0",
    );

    return yield* $.div(
      {
        class: ["transition-all", columnClass],

        onDragOver: (e) => {
          e.preventDefault();
          return kanban.hoverColumnId.set(column.id);
        },

        onDragLeave: (e) => {
          const target = e.currentTarget as HTMLElement;
          if (!target.contains(e.relatedTarget as Node)) {
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
      $.div(
        { class: "flex justify-between" },
        $.h2({ class: "font-bold text-lg mb-4" }, column.title),
        $.div(
          { class: "badge badge-neutral text-sm" },
          Readable.map(columnCards, (cards) => cards.length),
        ),
      ),
      each(columnCards, {
        key: (card) => Effect.runSync(card.id.get),
        container: () => $.div({ class: "space-y-2" }),
        render: (card) => Card({ card }),
        animate: {
          enterFrom: "card-enter",
          enter: "card-enter-active",
        },
      }),
      AddCardForm({ status: column.id }),
    );
  });
