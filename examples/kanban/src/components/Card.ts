import { Effect } from "effect";

import { $, Readable, when } from "@stax-ui/dom";

import { KanbanService } from "../services/KanbanService.js";
import type { Card as CardType } from "../types.js";
import { PriorityBadge } from "./PriorityBadge.js";

export const Card = (props: { card: Readable.Readable<CardType> }) =>
  Effect.gen(function* () {
    const kanban = yield* KanbanService;
    const card = yield* props.card.get;
    const id = yield* card.id.get;
    const title = card.title;
    const priority = card.priority;
    const description = card.description;

    const isDragging = Readable.map(kanban.dragState, (s) => s?.cardId === id);

    const cardClass = Readable.map(
      isDragging,
      (dragging) =>
        `card bg-base-100 shadow-sm cursor-grab hover:shadow-md transition-all ${
          dragging ? "opacity-50" : ""
        } hover:bg-base-300 overflow-hidden`,
    );

    return yield* $.div(
      { class: "card-wrapper" },
      $.div(
        { class: "card-inner" },
        $.div(
          {
            draggable: "true",
            class: cardClass,

            onClick: (e) => {
              // Don't open dialog if we started dragging
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
            { class: "card-body p-3 border-l-2 border-primary" },
            $.h3({ class: "font-medium text-sm" }, title),
            $.p({ class: "text-xs line-clamp-1" }, description),
            when(
              Readable.map(priority, (p) => p !== null),
              {
                onTrue: () =>
                  $.div({ class: "mt-2" }, PriorityBadge({ priority })),
                onFalse: () => $.span({}, ""),
              },
            ),
          ),
        ),
      ),
    );
  });
