---
title: "Forms Overview"
description: "Type-safe forms with Effect Schema validation, per-field reactive state, and progressive enhancement."
order: 0
---

# Forms Overview

`@stax-ui/form` is Stax's form layer. Forms are defined once at module level — same shape as a router or a machine — and their runtime state (values, errors, touched/dirty flags, submission status) is produced per-mount from the definition. Fields and validation sit on top of Effect Schema, so there's one source of truth for both the client-side form and whatever the server does with the submitted payload.

```bash
pnpm add @stax-ui/form effect
```

## Why a Separate Package

Stax already has signals, Readables, and `$.input` — you can wire a form by hand without any of this. The reason the package exists is everything that gets tedious once the form stops being trivial:

- **Nested, array, and map fields.** `Field.Array(Field.make(Schema.String))` gives you per-item state plus `push` / `insertAt` / `move`, and nested errors aggregate up to the parent correctly.
- **Validation timing.** `validateOn: "blur"` by default, with per-field overrides and a `debounce` for `"change"`.
- **Shared decoded types.** The Schema that validates a field is the Schema the server decodes against — the `decoded` payload on `onSubmit` is already in the shape your server code wants.
- **Progressive enhancement.** When a form is mounted inside `@stax-ui/platform`, setting `action` makes the `<form>` submit natively without JavaScript, and `onSubmit` only runs when JavaScript is available to intercept it.

## The Shape

A form has three pieces:

```ts
import { Effect, Schema } from "effect";
import { $, Readable, when } from "@stax-ui/dom";
import { Field, Form } from "@stax-ui/form";

// 1. The definition — at module level, like a router.
const LoginForm = Form.make({
  email: Field.make(
    Schema.String.pipe(Schema.nonEmptyString({ message: () => "Email is required" })),
    { validateOn: "blur" },
  ),
  password: Field.make(
    Schema.String.pipe(Schema.minLength(8, { message: () => "At least 8 characters" })),
    { validateOn: "blur" },
  ),
});

// 2. The field components — each yields only the state it needs.
const EmailField = () =>
  Effect.gen(function* () {
    const field = yield* LoginForm.fields.email;
    const hasError = Readable.map(field.errors, (e) => e.length > 0);

    return yield* $.div(
      {},
      $.label({}, "Email"),
      $.input({
        type: "email",
        value: field.value,
        onInput: (e) => field.set((e.target as HTMLInputElement).value),
        onBlur: () => field.blur(),
      }),
      when(hasError, {
        onTrue: () => $.span({ class: "error" }, "Invalid email"),
        onFalse: () => $.span(),
      }),
    );
  });

// 3. The mount — `.provide` creates the live state and injects it as context.
const LoginPage = () =>
  LoginForm.provide(
    {
      defaults: { email: "", password: "" },
      onSubmit: (ctx) =>
        Effect.tryPromise(() =>
          fetch("/api/login", {
            method: "POST",
            body: JSON.stringify(ctx.decoded),
          }),
        ),
    },
    $.form(
      { class: "login-form" },
      EmailField(),
      PasswordField(),
      SubmitButton(),
    ),
  );
```

Three things to notice:

- **`LoginForm.fields.email` is a context lookup**, not a reference. Each field component yields only the field it cares about; the sibling fields don't appear in its type.
- **`.provide` is where state is born.** The same `LoginForm` definition can be mounted multiple times (two login modals, say), and each mount gets its own independent state.
- **`$.form` picks up `onSubmit` automatically.** `.provide` injects the submit handler into the first element it finds via a context, so you don't wire it manually.

## Field Types

The field constructors cover the shapes a form actually takes:

```ts
// Leaf — a single Schema.
Field.make(Schema.String);

// Struct — nested fields with aggregated errors / touched / dirty.
Field.make({
  street: Field.make(Schema.String),
  city: Field.make(Schema.String),
});

// Array — ordered collection with push / pop / insertAt / move.
Field.Array(Field.make(Schema.String));

// Map — dynamic key/value pairs with setEntry / delete.
Field.Map(Schema.String, Field.make(Schema.String));
```

Nested fields aggregate: errors on `address.fields.street` surface on `address.errors`; touching any child flips `address.touched`.

## State: `field` vs `form`

Each field component yields its own field state through the context, and anything that needs form-wide state (submit buttons, status indicators) yields `form`:

```ts
const field = yield* LoginForm.fields.email;
field.value    // Signal<string>
field.errors   // Readable<ParseIssue[]>
field.touched  // Readable<boolean>
field.dirty    // Readable<boolean>
yield* field.set("alice@example.com");
yield* field.blur();
yield* field.reset();

const form = yield* LoginForm.form;
form.isValid       // Readable<boolean>
form.isSubmitting  // Readable<boolean>
form.isDirty       // Readable<boolean>
form.errors        // Readable<ParseIssue[]> — form-level
yield* form.submit();
yield* form.reset();
const decoded = yield* form.getDecoded();  // validated, Schema-shaped
```

Everything reactive lands on a `Readable`, so bind them with the same primitives used elsewhere in a Stax app: `$.input({ value: field.value })`, `when(hasError, { ... })`, `$.button({ disabled: form.isSubmitting })`.

## Validation Timing

Validation runs on blur by default. Change it per-field or form-wide:

```ts
// Form-wide
Form.make(fields, { validateOn: "blur", debounce: 200 });

// Per-field override
Field.make(Schema.String, { validateOn: "change", debounce: 300 });
```

Options are `"blur"`, `"change"` (respects `debounce` ms), and `"submit"` (only when `form.submit()` runs).

## Submit Handlers

Submit handlers can sit at the form level (shared by every mount — think analytics) and at the instance level (specific to this mount — the actual API call):

```ts
const MyForm = Form.make(
  { name: Field.make(Schema.String) },
  {
    onSubmit: (ctx) =>
      Effect.sync(() => analytics.track("form_submit", ctx.decoded)),
  },
);

MyForm.provide(
  {
    defaults: { name: "" },
    onSubmit: (ctx) => saveToServer(ctx.decoded),
  },
  children,
);
```

Both run on a successful validation; the form-level handler goes first. The submit context carries both `encoded` (raw values) and `decoded` (Schema-validated — the shape your server wants).

## Progressive Enhancement

Mounted inside `@stax-ui/platform`, a form can submit natively without JavaScript. Set `action` on `.provide`:

```ts
MyForm.provide(
  {
    defaults: { name: "" },
    action: actions.create,  // from RouteDataContext
    onSubmit: (ctx) =>
      Effect.tryPromise(() =>
        fetch(actions.create, {
          method: "POST",
          body: JSON.stringify(ctx.encoded),
        }),
      ),
  },
  $.form({ class: "my-form" }, ...fields),
);
```

The rendered `<form>` gets `action` and `method="POST"`, and when JavaScript is unavailable the browser handles the POST itself. With JavaScript, `onSubmit` intercepts and the native navigation is suppressed.

## When Not to Use It

If a form is one input and a button, you don't need `@stax-ui/form` — a bare Signal is already smaller than the Schema it would wrap. Reach for the package when there's more than one field, or when validation shows up more than once, or when the shape of the submitted payload matters to code downstream of the submit.

See the full [package README](https://github.com/stax-ui/stax/tree/main/packages/form) for the exhaustive API — this page covers the parts you use most.
