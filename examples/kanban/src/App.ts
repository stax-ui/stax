import { Effect } from "effect";

import { $, provide } from "@stax-ui/dom";

import { CardDetailDialog, KanbanBoard } from "./components/index.js";
import { KanbanService, makeKanbanService } from "./services/KanbanService.js";

export const App = () =>
  Effect.gen(function* () {
    const kanbanService = yield* makeKanbanService();

    return yield* provide(
      KanbanService,
      kanbanService,
      $.div(
        { class: "min-h-screen" },
        $.header(
          { class: "navbar bg-base-100 shadow-sm" },
          $.h1({ class: "text-xl font-bold px-4" }, "Stax Kanban Board"),
        ),
        KanbanBoard(),
        CardDetailDialog(),
      ),
    );
  });
