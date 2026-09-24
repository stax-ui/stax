import { describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { beforeEach, expect, vi } from "vitest";

import { Signal } from "@stax-ui/core";

import { collect } from "../Collect.js";
import { DOMRendererLive } from "../Render/DOMRenderer.js";
import {
  $,
  a,
  button,
  div,
  empty,
  form,
  h1,
  img,
  input,
  li,
  MergePropsCtx,
  of,
  p,
  span,
  svg,
  ul,
} from "./DOMElements.js";
import { getUnsafe as getRef, make as ref } from "./ref.js";

const TestLayer = DOMRendererLive;

describe("DOMElements", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  describe("basic element creation", () => {
    it.scopedLive("should create a div with no args", () =>
      Effect.gen(function* () {
        const el = yield* div();
        expect(el).toBeInstanceOf(HTMLDivElement);
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scopedLive("should create a div with attributes only", () =>
      Effect.gen(function* () {
        const el = yield* div({ id: "test", class: "foo bar" });
        expect(el.id).toBe("test");
        expect(el.className).toBe("foo bar");
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scopedLive("should create a div with child effect", () =>
      Effect.gen(function* () {
        const el = yield* div(Effect.succeed("Hello"));
        expect(el.textContent).toBe("Hello");
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scopedLive("should create a div with attrs and children", () =>
      Effect.gen(function* () {
        const el = yield* div(
          { class: "container" },
          Effect.succeed("Content"),
        );
        expect(el.className).toBe("container");
        expect(el.textContent).toBe("Content");
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scopedLive("should create nested elements", () =>
      Effect.gen(function* () {
        const el = yield* div(
          { class: "parent" },
          Effect.gen(function* () {
            const child = yield* span("Nested");
            return child;
          }),
        );
        expect(el.className).toBe("parent");
        expect(el.children.length).toBe(1);
        expect(el.children[0].tagName).toBe("SPAN");
        expect(el.children[0].textContent).toBe("Nested");
      }).pipe(Effect.provide(TestLayer)),
    );
  });

  describe("various HTML elements", () => {
    it.scopedLive("should create headings", () =>
      Effect.gen(function* () {
        const heading = yield* h1("Title");
        expect(heading).toBeInstanceOf(HTMLHeadingElement);
        expect(heading.textContent).toBe("Title");
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scopedLive("should create paragraphs", () =>
      Effect.gen(function* () {
        const para = yield* p("Some text");
        expect(para).toBeInstanceOf(HTMLParagraphElement);
        expect(para.textContent).toBe("Some text");
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scopedLive("should create buttons", () =>
      Effect.gen(function* () {
        const btn = yield* button(
          { type: "submit", disabled: true },
          Effect.succeed("Click"),
        );
        expect(btn).toBeInstanceOf(HTMLButtonElement);
        expect(btn.type).toBe("submit");
        expect(btn.disabled).toBe(true);
        expect(btn.textContent).toBe("Click");
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scopedLive("should create inputs", () =>
      Effect.gen(function* () {
        const inp = yield* input({ type: "text", placeholder: "Enter..." });
        expect(inp).toBeInstanceOf(HTMLInputElement);
        expect(inp.type).toBe("text");
        expect(inp.placeholder).toBe("Enter...");
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scopedLive("should create links", () =>
      Effect.gen(function* () {
        const link = yield* a(
          { href: "/page", target: "_blank" },
          Effect.succeed("Link"),
        );
        expect(link).toBeInstanceOf(HTMLAnchorElement);
        expect(link.href).toContain("/page");
        expect(link.target).toBe("_blank");
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scopedLive("should create images", () =>
      Effect.gen(function* () {
        const image = yield* img({ src: "/img.png", alt: "Image" });
        expect(image).toBeInstanceOf(HTMLImageElement);
        expect(image.src).toContain("/img.png");
        expect(image.alt).toBe("Image");
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scopedLive("should create forms", () =>
      Effect.gen(function* () {
        const frm = yield* form({ action: "/submit", method: "post" });
        expect(frm).toBeInstanceOf(HTMLFormElement);
        expect(frm.action).toContain("/submit");
        expect(frm.method).toBe("post");
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scopedLive("should create lists", () =>
      Effect.gen(function* () {
        const list = yield* ul(
          Effect.gen(function* () {
            const items = [];
            items.push(yield* li("Item 1"));
            items.push(yield* li("Item 2"));
            return items;
          }),
        );
        expect(list).toBeInstanceOf(HTMLUListElement);
        expect(list.children.length).toBe(2);
      }).pipe(Effect.provide(TestLayer)),
    );
  });

  describe("SVG elements", () => {
    it.scopedLive("should create SVG element with namespace", () =>
      Effect.gen(function* () {
        const el = yield* svg({ viewBox: "0 0 100 100" });
        expect(el).toBeInstanceOf(SVGElement);
        expect(el.tagName.toLowerCase()).toBe("svg");
        expect(el.getAttribute("viewBox")).toBe("0 0 100 100");
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scopedLive("should create SVG shapes", () =>
      Effect.gen(function* () {
        const el = yield* $.rect({
          x: "10",
          y: "10",
          width: "80",
          height: "80",
        });
        expect(el).toBeInstanceOf(SVGElement);
        expect(el.tagName.toLowerCase()).toBe("rect");
        expect(el.getAttribute("x")).toBe("10");
      }).pipe(Effect.provide(TestLayer)),
    );
  });

  describe("class attribute", () => {
    it.scopedLive("should handle string class", () =>
      Effect.gen(function* () {
        const el = yield* div({ class: "foo bar baz" });
        expect(el.className).toBe("foo bar baz");
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scopedLive("should handle array class", () =>
      Effect.gen(function* () {
        const el = yield* div({ class: ["foo", "bar", "baz"] });
        expect(el.className).toBe("foo bar baz");
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scopedLive("should handle reactive class", () =>
      Effect.gen(function* () {
        const className = yield* Signal.make("initial");
        const el = yield* div({ class: className });
        expect(el.className).toBe("initial");

        yield* Effect.sleep("20 millis");
        yield* className.set("updated");
        yield* Effect.sleep("20 millis");
        expect(el.className).toBe("updated");
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scopedLive("should skip undefined / null / false in a class array", () =>
      Effect.gen(function* () {
        const el = yield* div({
          class: ["foo", undefined, "bar", null, false, ""],
        });
        expect(el.className).toBe("foo bar");
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scopedLive("should flatten nested class arrays", () =>
      Effect.gen(function* () {
        const defaults = ["base", "block"];
        const overrides: string | undefined = "override";
        const el = yield* div({ class: ["outer", defaults, [overrides]] });
        expect(el.className).toBe("outer base block override");
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scopedLive("should accept a top-level undefined class as a no-op", () =>
      Effect.gen(function* () {
        const el = yield* div({ class: undefined });
        expect(el.className).toBe("");
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scopedLive("should update a reactive item nested inside an array", () =>
      Effect.gen(function* () {
        const dynamic = yield* Signal.make("one");
        const el = yield* div({
          class: ["static", ["nested-static", dynamic], undefined],
        });
        expect(el.className).toBe("static nested-static one");

        yield* Effect.sleep("20 millis");
        yield* dynamic.set("two");
        yield* Effect.sleep("20 millis");
        expect(el.className).toBe("static nested-static two");
      }).pipe(Effect.provide(TestLayer)),
    );
  });

  describe("style attribute", () => {
    it.scopedLive("should handle style object", () =>
      Effect.gen(function* () {
        const el = yield* div({ style: { color: "red", fontSize: "14px" } });
        expect(el.style.color).toBe("red");
        expect(el.style.fontSize).toBe("14px");
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scopedLive("should handle reactive style values", () =>
      Effect.gen(function* () {
        const color = yield* Signal.make("red");
        const el = yield* div({ style: { color } });
        expect(el.style.color).toBe("red");

        yield* Effect.sleep("20 millis");
        yield* color.set("blue");
        yield* Effect.sleep("20 millis");
        expect(el.style.color).toBe("blue");
      }).pipe(Effect.provide(TestLayer)),
    );
  });

  describe("event handlers", () => {
    it.scopedLive("should handle onClick", () => {
      const clicked = vi.fn();
      return Effect.gen(function* () {
        const el = yield* button(
          { onClick: () => Effect.sync(() => clicked()) },
          Effect.succeed("Click"),
        );
        el.click();
        yield* Effect.sleep("10 millis");
        expect(clicked).toHaveBeenCalled();
      }).pipe(Effect.provide(TestLayer));
    });

    it.scopedLive("should handle onClick with sync effect", () => {
      let effectRan = false;
      return Effect.gen(function* () {
        const el = yield* button(
          {
            onClick: () =>
              Effect.sync(() => {
                effectRan = true;
              }),
          },
          Effect.succeed("Click"),
        );
        el.click();
        // Wait for effect to run
        yield* Effect.sleep("10 millis");
        expect(effectRan).toBe(true);
      }).pipe(Effect.provide(TestLayer));
    });

    it.scopedLive("should handle onInput", () => {
      const inputHandler = vi.fn();
      return Effect.gen(function* () {
        const el = yield* input({
          onInput: () => Effect.sync(() => inputHandler()),
        });
        el.dispatchEvent(new Event("input"));
        yield* Effect.sleep("10 millis");
        expect(inputHandler).toHaveBeenCalled();
      }).pipe(Effect.provide(TestLayer));
    });
  });

  describe("ref", () => {
    it.scopedLive("should bind element to ref", () =>
      Effect.gen(function* () {
        const myRef = yield* ref<HTMLDivElement>();
        const el = yield* div({ ref: myRef, id: "ref-test" });
        const refEl = getRef(myRef);
        expect(refEl).toBe(el);
        expect(refEl!.id).toBe("ref-test");
      }).pipe(Effect.provide(TestLayer)),
    );
  });

  describe("reactive attributes", () => {
    it.scopedLive("should handle reactive id", () =>
      Effect.gen(function* () {
        const id = yield* Signal.make("initial-id");
        const el = yield* div({ id });
        expect(el.id).toBe("initial-id");

        yield* Effect.sleep("20 millis");
        yield* id.set("updated-id");
        yield* Effect.sleep("20 millis");
        expect(el.id).toBe("updated-id");
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scopedLive("should handle reactive disabled", () =>
      Effect.gen(function* () {
        const disabled = yield* Signal.make(false);
        const el = yield* button({ disabled });
        expect(el.disabled).toBe(false);

        yield* Effect.sleep("20 millis");
        yield* disabled.set(true);
        yield* Effect.sleep("20 millis");
        expect(el.disabled).toBe(true);
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scopedLive("should handle reactive innerHTML", () =>
      Effect.gen(function* () {
        const html = yield* Signal.make("<b>Bold</b>");
        const el = yield* div({ innerHTML: html });
        expect(el.innerHTML).toBe("<b>Bold</b>");

        yield* Effect.sleep("20 millis");
        yield* html.set("<i>Italic</i>");
        yield* Effect.sleep("20 millis");
        expect(el.innerHTML).toBe("<i>Italic</i>");
      }).pipe(Effect.provide(TestLayer)),
    );
  });

  describe("children", () => {
    it.scopedLive("should handle string child", () =>
      Effect.gen(function* () {
        const el = yield* div("Hello World");
        expect(el.textContent).toBe("Hello World");
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scopedLive("should handle number child", () =>
      Effect.gen(function* () {
        const el = yield* div(42);
        expect(el.textContent).toBe("42");
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scopedLive("should handle Readable child", () =>
      Effect.gen(function* () {
        const text = yield* Signal.make("initial");
        const el = yield* div(text);
        expect(el.textContent).toBe("initial");

        yield* Effect.sleep("20 millis");
        yield* text.set("updated");
        yield* Effect.sleep("20 millis");
        expect(el.textContent).toBe("updated");
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scopedLive("should handle array of children", () =>
      Effect.gen(function* () {
        const el = yield* div(
          Effect.gen(function* () {
            return [yield* span("One"), yield* span("Two")];
          }),
        );
        expect(el.children.length).toBe(2);
      }).pipe(Effect.provide(TestLayer)),
    );
  });

  describe("input value", () => {
    it.scopedLive("should handle value attribute on input", () =>
      Effect.gen(function* () {
        const el = yield* input({ value: "initial" });
        expect(el.value).toBe("initial");
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scopedLive("should handle reactive value on input", () =>
      Effect.gen(function* () {
        const value = yield* Signal.make("initial");
        const el = yield* input({ value });
        expect(el.value).toBe("initial");

        yield* Effect.sleep("20 millis");
        yield* value.set("updated");
        yield* Effect.sleep("20 millis");
        expect(el.value).toBe("updated");
      }).pipe(Effect.provide(TestLayer)),
    );
  });

  describe("MergePropsCtx", () => {
    it.scopedLive("should merge props from context", () =>
      Effect.gen(function* () {
        const el = yield* Effect.provideService(
          div({ class: "user-class" }),
          MergePropsCtx,
          { id: "injected-id", "data-test": "injected" },
        );
        expect(el.id).toBe("injected-id");
        expect(el.className).toBe("user-class");
        expect(el.dataset.test).toBe("injected");
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scopedLive("should allow user props to override merged props", () =>
      Effect.gen(function* () {
        const el = yield* Effect.provideService(
          div({ id: "user-id" }),
          MergePropsCtx,
          { id: "injected-id" },
        );
        // User prop should win
        expect(el.id).toBe("user-id");
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scopedLive("should not propagate MergePropsCtx to children", () =>
      Effect.gen(function* () {
        const el = yield* Effect.provideService(
          div(
            { class: "parent" },
            Effect.gen(function* () {
              return yield* span({ class: "child" });
            }),
          ),
          MergePropsCtx,
          { "data-injected": "true" },
        );
        // Parent should have the injected attr
        expect(el.dataset.injected).toBe("true");
        // Child should NOT have the injected attr
        const child = el.children[0] as HTMLElement;
        expect(child.dataset.injected).toBeUndefined();
      }).pipe(Effect.provide(TestLayer)),
    );
  });

  describe("$ namespace", () => {
    it("should have all common elements", () => {
      expect($.div).toBeDefined();
      expect($.span).toBeDefined();
      expect($.p).toBeDefined();
      expect($.button).toBeDefined();
      expect($.input).toBeDefined();
      expect($.a).toBeDefined();
      expect($.ul).toBeDefined();
      expect($.li).toBeDefined();
      expect($.form).toBeDefined();
      expect($.svg).toBeDefined();
      expect($.path).toBeDefined();
    });

    it("should have helper functions", () => {
      expect($.of).toBeDefined();
      expect($.empty).toBeDefined();
    });
  });

  describe("helpers", () => {
    it.scopedLive("of should wrap a value in an Effect", () =>
      Effect.gen(function* () {
        const el = yield* div(of("Wrapped"));
        expect(el.textContent).toBe("Wrapped");
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scopedLive("empty should return empty children", () =>
      Effect.gen(function* () {
        const el = yield* div(empty);
        expect(el.children.length).toBe(0);
        expect(el.textContent).toBe("");
      }).pipe(Effect.provide(TestLayer)),
    );
  });

  // Regression tests for the variadic-children API (issue #56). These guard
  // the ChildInput normalization: primitive auto-wrapping, nullish/boolean
  // skip, recursive array flattening, and backward-compat with `collect` /
  // `$.of` / raw Effects.
  describe("variadic children", () => {
    describe("primitive auto-wrapping", () => {
      it.scopedLive("wraps a bare string as a text node", () =>
        Effect.gen(function* () {
          const el = yield* div({}, "hello");
          expect(el.textContent).toBe("hello");
          expect(el.childNodes.length).toBe(1);
          expect(el.childNodes[0].nodeType).toBe(Node.TEXT_NODE);
        }).pipe(Effect.provide(TestLayer)),
      );

      it.scopedLive("wraps a bare number as a text node", () =>
        Effect.gen(function* () {
          const el = yield* div({}, 42);
          expect(el.textContent).toBe("42");
        }).pipe(Effect.provide(TestLayer)),
      );

      it.scopedLive("preserves multiple sibling text children in order", () =>
        Effect.gen(function* () {
          const el = yield* div({}, "a", "b", "c");
          expect(el.textContent).toBe("abc");
        }).pipe(Effect.provide(TestLayer)),
      );

      it.scopedLive("interleaves text and Element children", () =>
        Effect.gen(function* () {
          const el = yield* div({}, "before ", span({}, "middle"), " after");
          expect(el.children.length).toBe(1);
          expect(el.children[0].tagName).toBe("SPAN");
          expect(el.textContent).toBe("before middle after");
        }).pipe(Effect.provide(TestLayer)),
      );
    });

    describe("nullish and boolean skip (React parity)", () => {
      it.scopedLive("skips null children", () =>
        Effect.gen(function* () {
          const el = yield* div({}, "before", null, "after");
          expect(el.textContent).toBe("beforeafter");
        }).pipe(Effect.provide(TestLayer)),
      );

      it.scopedLive("skips undefined children", () =>
        Effect.gen(function* () {
          const el = yield* div({}, "before", undefined, "after");
          expect(el.textContent).toBe("beforeafter");
        }).pipe(Effect.provide(TestLayer)),
      );

      it.scopedLive("skips false children (conditional && el)", () =>
        Effect.gen(function* () {
          const show = false;
          const el = yield* div({}, "x", show && span({}, "hidden"), "y");
          expect(el.children.length).toBe(0);
          expect(el.textContent).toBe("xy");
        }).pipe(Effect.provide(TestLayer)),
      );

      it.scopedLive("skips true children for symmetry", () =>
        Effect.gen(function* () {
          const el = yield* div({}, "x", true, "y");
          expect(el.textContent).toBe("xy");
        }).pipe(Effect.provide(TestLayer)),
      );

      it.scopedLive("supports the conditional-render idiom", () =>
        Effect.gen(function* () {
          const show = true;
          const el = yield* div({}, "before ", show && "shown", " after");
          expect(el.textContent).toBe("before shown after");
        }).pipe(Effect.provide(TestLayer)),
      );
    });

    describe("array flattening", () => {
      it.scopedLive("flattens a single-level array of children", () =>
        Effect.gen(function* () {
          const items = ["a", "b", "c"];
          const el = yield* div({}, items);
          expect(el.textContent).toBe("abc");
        }).pipe(Effect.provide(TestLayer)),
      );

      it.scopedLive("flattens arrays of Elements produced by .map()", () =>
        Effect.gen(function* () {
          const el = yield* ul(
            {},
            [1, 2, 3].map((n) => li({}, `item ${n}`)),
          );
          expect(el.children.length).toBe(3);
          expect(el.children[0].textContent).toBe("item 1");
          expect(el.children[2].textContent).toBe("item 3");
        }).pipe(Effect.provide(TestLayer)),
      );

      // Nested arrays are intentionally not part of ChildInput. Use
      // `.flat()` or the variadic form to combine multiple lists.

      it.scopedLive("skips empty arrays", () =>
        Effect.gen(function* () {
          const el = yield* div({}, "before", [], "after");
          expect(el.textContent).toBe("beforeafter");
          expect(el.childNodes.length).toBe(2);
        }).pipe(Effect.provide(TestLayer)),
      );

      it.scopedLive("skips nullish/boolean inside arrays", () =>
        Effect.gen(function* () {
          const el = yield* div({}, ["a", null, "b", false, "c", undefined]);
          expect(el.textContent).toBe("abc");
        }).pipe(Effect.provide(TestLayer)),
      );
    });

    describe("call-shape resolution", () => {
      it.scopedLive("no args produces an empty element", () =>
        Effect.gen(function* () {
          const el = yield* div();
          expect(el).toBeInstanceOf(HTMLDivElement);
          expect(el.childNodes.length).toBe(0);
        }).pipe(Effect.provide(TestLayer)),
      );

      it.scopedLive("attrs-only produces an empty element with attrs", () =>
        Effect.gen(function* () {
          const el = yield* div({ id: "x", class: "y" });
          expect(el.id).toBe("x");
          expect(el.className).toBe("y");
          expect(el.childNodes.length).toBe(0);
        }).pipe(Effect.provide(TestLayer)),
      );

      it.scopedLive("children-only (first arg is a string) skips attrs", () =>
        Effect.gen(function* () {
          const el = yield* div("no attrs here");
          expect(el.id).toBe("");
          expect(el.className).toBe("");
          expect(el.textContent).toBe("no attrs here");
        }).pipe(Effect.provide(TestLayer)),
      );

      it.scopedLive("children-only (first arg is an Element) skips attrs", () =>
        Effect.gen(function* () {
          const el = yield* div(span({}, "nested"));
          expect(el.children.length).toBe(1);
          expect(el.children[0].tagName).toBe("SPAN");
        }).pipe(Effect.provide(TestLayer)),
      );

      it.scopedLive("children-only (first arg is an array) skips attrs", () =>
        Effect.gen(function* () {
          const el = yield* div(["a", "b"]);
          expect(el.textContent).toBe("ab");
        }).pipe(Effect.provide(TestLayer)),
      );
    });

    describe("backward compatibility", () => {
      it.scopedLive("accepts a `collect(...)` bundle as a single child", () =>
        Effect.gen(function* () {
          const el = yield* div(
            { class: "container" },
            collect(span({}, "a"), span({}, "b")),
          );
          expect(el.className).toBe("container");
          expect(el.children.length).toBe(2);
          expect(el.children[0].textContent).toBe("a");
          expect(el.children[1].textContent).toBe("b");
        }).pipe(Effect.provide(TestLayer)),
      );

      it.scopedLive("accepts an `$.of(...)` text-node effect", () =>
        Effect.gen(function* () {
          const el = yield* div({}, of("hello"));
          expect(el.textContent).toBe("hello");
        }).pipe(Effect.provide(TestLayer)),
      );

      it.scopedLive("mixes `collect(...)` with variadic siblings", () =>
        Effect.gen(function* () {
          const el = yield* div(
            {},
            "start",
            collect(span({}, "in-collect-1"), span({}, "in-collect-2")),
            "end",
          );
          expect(el.children.length).toBe(2);
          expect(el.textContent).toBe("startin-collect-1in-collect-2end");
        }).pipe(Effect.provide(TestLayer)),
      );

      it.scopedLive("accepts a raw Effect<string>", () =>
        Effect.gen(function* () {
          const el = yield* div({}, Effect.succeed("raw"));
          expect(el.textContent).toBe("raw");
        }).pipe(Effect.provide(TestLayer)),
      );
    });

    describe("Readable signals as children", () => {
      it.scopedLive("accepts a Signal directly as a variadic child", () =>
        Effect.gen(function* () {
          const s = yield* Signal.make("initial");
          const el = yield* div({}, "prefix ", s);
          expect(el.textContent).toBe("prefix initial");
        }).pipe(Effect.provide(TestLayer)),
      );
    });

    describe("SVG factory parity", () => {
      it.scopedLive("SVG factories accept the same variadic shape", () =>
        Effect.gen(function* () {
          const el = yield* svg({ width: "100" }, "text-child", null, false, [
            "nested",
          ]);
          expect(el).toBeInstanceOf(SVGElement);
          expect(el.getAttribute("width")).toBe("100");
          expect(el.textContent).toBe("text-childnested");
        }).pipe(Effect.provide(TestLayer)),
      );
    });
  });

  describe("data and aria attributes", () => {
    it.scopedLive("should handle data-* attributes", () =>
      Effect.gen(function* () {
        const el = yield* div({
          "data-testid": "my-div",
          "data-value": "123",
        });
        expect(el.dataset.testid).toBe("my-div");
        expect(el.dataset.value).toBe("123");
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scopedLive("should handle aria-* attributes", () =>
      Effect.gen(function* () {
        const el = yield* button({
          "aria-label": "Close",
          "aria-expanded": "false",
        });
        expect(el.getAttribute("aria-label")).toBe("Close");
        expect(el.getAttribute("aria-expanded")).toBe("false");
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scopedLive(
      "should stringify boolean data-* values to 'true' / 'false'",
      () =>
        Effect.gen(function* () {
          const el = yield* div({
            "data-active": true,
            "data-hidden": false,
          });
          expect(el.getAttribute("data-active")).toBe("true");
          expect(el.getAttribute("data-hidden")).toBe("false");
        }).pipe(Effect.provide(TestLayer)),
    );

    it.scopedLive(
      "should stringify boolean aria-* values to 'true' / 'false'",
      () =>
        Effect.gen(function* () {
          const el = yield* button({
            "aria-expanded": true,
            "aria-pressed": false,
          });
          expect(el.getAttribute("aria-expanded")).toBe("true");
          expect(el.getAttribute("aria-pressed")).toBe("false");
        }).pipe(Effect.provide(TestLayer)),
    );

    it.scopedLive(
      "should preserve HTML boolean-attribute semantics for `disabled` / `checked` / etc.",
      () =>
        Effect.gen(function* () {
          const on = yield* button({ disabled: true });
          const off = yield* button({ disabled: false });
          expect(on.getAttribute("disabled")).toBe(""); // present, empty
          expect(off.hasAttribute("disabled")).toBe(false); // absent
        }).pipe(Effect.provide(TestLayer)),
    );
  });
});
