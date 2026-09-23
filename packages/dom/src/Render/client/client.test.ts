import { Effect, Fiber } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { $ } from "../../Element/index.js";
import { DOMRendererLive } from "../DOMRenderer.js";
import { _mountScoped as mount } from "./client.js";

describe("_mountScoped", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement("div");
    container.id = "root";
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("should mount element to container", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* mount($.div({}, "Hello"), container);

          expect(container.children.length).toBe(1);
          expect(container.textContent).toBe("Hello");
        }),
      ),
    );
  });

  it("should mount nested elements", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* mount(
            $.div({}, $.span({}, "Hello"), $.span({}, "World")),
            container,
          );

          expect(container.children.length).toBe(1);
          const mounted = container.children[0];
          expect(mounted.children.length).toBe(2);
        }),
      ),
    );
  });

  it("should remove element when scope closes", async () => {
    const fiber = Effect.runFork(
      Effect.scoped(
        Effect.gen(function* () {
          yield* mount($.div({}, "Mounted"), container);
          yield* Effect.sleep(100);
        }),
      ),
    );

    // Wait for mount
    await new Promise((r) => setTimeout(r, 10));
    expect(container.children.length).toBe(1);
    expect(container.textContent).toBe("Mounted");

    // Interrupt fiber to close scope
    await Effect.runPromise(Fiber.interrupt(fiber));

    // Element should be removed
    expect(container.children.length).toBe(0);
  });

  it("should not remove element if parent changed", async () => {
    let mountedElement: HTMLElement | null = null;

    const fiber = Effect.runFork(
      Effect.scoped(
        Effect.gen(function* () {
          const el = yield* $.div({}, "Test");
          mountedElement = el;
          yield* mount(Effect.succeed(el), container);
          yield* Effect.sleep(100);
        }),
      ).pipe(Effect.provide(DOMRendererLive)),
    );

    await new Promise((r) => setTimeout(r, 10));

    // Move the element to a different parent
    const newParent = document.createElement("div");
    document.body.appendChild(newParent);
    newParent.appendChild(mountedElement!);

    // Close scope
    await Effect.runPromise(Fiber.interrupt(fiber));

    // Original container should be empty (element was moved)
    expect(container.children.length).toBe(0);
    // Element should still exist in new parent
    expect(newParent.children.length).toBe(1);
  });

  it("should support mounting multiple elements to same container", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* mount($.div({}, "First"), container);
          yield* mount($.div({}, "Second"), container);

          expect(container.children.length).toBe(2);
          expect(container.children[0].textContent).toBe("First");
          expect(container.children[1].textContent).toBe("Second");
        }),
      ),
    );
  });
});
