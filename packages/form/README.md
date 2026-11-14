# @stax-ui/form

Type-safe form handling for Stax applications with Effect Schema validation.

## Installation

```bash
pnpm add @stax-ui/form effect
```

> `@stax-ui/dom` re-exports `@stax-ui/core`, so you don't need to install core separately.

## Overview

Forms in `@stax-ui/form` are defined separately from their runtime state. This separation allows you to:

- Define forms at module level (like routers)
- Reuse form definitions across components
- Get full type inference for field access
- Use context-based field access via `yield*`

## Basic Usage

```ts
import { Effect, Schema } from "effect";
import { $, collect, Readable, when } from "@stax-ui/dom";
import { Field, Form } from "@stax-ui/form";

// 1. Define the form at module level
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

// 2. Create field components — each yields only the state it needs
const EmailField = () =>
  Effect.gen(function* () {
    const field = yield* LoginForm.fields.email;
    const hasError = Readable.map(field.errors, (e) => e.length > 0);

    return yield* $.div(
      $.label("Email"),
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

const PasswordField = () =>
  Effect.gen(function* () {
    const field = yield* LoginForm.fields.password;
    const hasError = Readable.map(field.errors, (e) => e.length > 0);

    return yield* $.div(
      $.label("Password"),
      $.input({
        type: "password",
        value: field.value,
        onInput: (e) => field.set((e.target as HTMLInputElement).value),
        onBlur: () => field.blur(),
      }),
      when(hasError, {
        onTrue: () => $.span({ class: "error" }, "Too short"),
        onFalse: () => $.span(),
      }),
    );
  });

const SubmitButton = () =>
  Effect.gen(function* () {
    const form = yield* LoginForm.form;

    return yield* $.button(
      {
        type: "submit",
        disabled: form.isSubmitting,
      },
      Readable.map(form.isSubmitting, (s) => (s ? "Submitting..." : "Log In")),
    );
  });

// 3. Compose the form — $.form automatically receives onSubmit from Form.provide
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

> **Note:** `Form.provide` automatically injects an `onSubmit` handler (with `preventDefault`)
> into the first element via context. Just make sure `$.form` is your first element.

## Field Definition

Fields wrap Effect Schemas with UI configuration:

```ts
import { Field } from "@stax-ui/form";
import { Schema } from "effect";

// Basic field
const nameField = Field.make(Schema.String);

// Field with validation config
const emailField = Field.make(
  Schema.String.pipe(Schema.nonEmptyString()),
  { validateOn: "blur", debounce: 300 },
);

// Nested struct field
const addressField = Field.make({
  street: Field.make(Schema.String),
  city: Field.make(Schema.String),
  zip: Field.make(Schema.String),
});

// Array field
const tagsField = Field.Array(Field.make(Schema.String));

// Map field (dynamic key-value pairs)
const metadataField = Field.Map(Schema.String, Field.make(Schema.String));
```

## Validation Timing

Control when validation runs per-field or form-wide:

```ts
// Per-field config (overrides form default)
Field.make(Schema.String, { validateOn: "change" });

// Form-wide default
Form.make(
  { name: Field.make(Schema.String) },
  { validateOn: "blur", debounce: 200 },
);
```

Options:
- `"blur"` — Validate when field loses focus (default)
- `"change"` — Validate on every change (respects `debounce`)
- `"submit"` — Only validate on form submission

## Field State

Each field component yields only the state it needs. This keeps components focused and makes the data flow clear:

```ts
const NameField = () =>
  Effect.gen(function* () {
    const field = yield* MyForm.fields.name;

    return yield* $.input({
      value: field.value,
      onInput: (e) => field.set((e.target as HTMLInputElement).value),
      onBlur: () => field.blur(),
    });
  });
```

### Leaf Field State

```ts
const field = yield* MyForm.fields.name;

// Reactive values
field.value    // Signal<T> — current value
field.errors   // Readable<ParseIssue[]> — validation errors
field.touched  // Readable<boolean> — has been blurred
field.dirty    // Readable<boolean> — changed from initial

// Actions (all return Effect<void>)
yield* field.set("new value");
yield* field.update((v) => v.toUpperCase());
yield* field.blur();   // Mark as touched, triggers validation
yield* field.focus();  // Mark as focused
yield* field.reset();  // Reset to initial value
```

### Struct Field State

Struct fields provide access to nested field states:

```ts
const address = yield* MyForm.fields.address;

// Aggregate reactive values
address.value    // Signal<{ street, city, zip }>
address.errors   // Readable<ParseIssue[]> — aggregated from nested fields
address.touched  // Readable<boolean> — true if any nested field touched
address.dirty    // Readable<boolean> — true if any nested field changed

// Access nested states
address.fields.street  // LeafFieldState<string>
address.fields.city    // LeafFieldState<string>

// Actions
yield* address.set({ street: "123 Main", city: "NYC", zip: "10001" });
yield* address.reset();
```

### Array Field State

Array fields provide collection manipulation and per-item state:

```ts
const tags = yield* MyForm.fields.tags;

// Reactive values
tags.value    // Signal<readonly string[]>
tags.length   // Readable<number>
tags.items    // Readable<readonly ItemState[]> — per-item field states
tags.errors   // Readable<ParseIssue[]> — aggregated
tags.touched  // Readable<boolean> — aggregated
tags.dirty    // Readable<boolean> — aggregated

// Mutations (all return Effect<void>)
yield* tags.push("new-tag");
yield* tags.pop();
yield* tags.unshift("first");
yield* tags.shift();
yield* tags.insertAt(2, "middle");
yield* tags.removeAt(1);
yield* tags.move(0, 3);         // Move item from index 0 to index 3
yield* tags.clear();
yield* tags.reset();
```

### Map Field State

Map fields provide dynamic key-value pairs:

```ts
const metadata = yield* MyForm.fields.metadata;

// Reactive values
metadata.value    // Readable<ReadonlyMap<string, string>>
metadata.size     // Readable<number>
metadata.entries  // Readable<ReadonlyMap<string, EntryState>>

// Mutations
yield* metadata.setEntry("color", "blue");
const entry = yield* metadata.getEntry("color");  // EntryState | undefined
yield* metadata.delete("color");
yield* metadata.clear();
yield* metadata.reset();
```

## Form State

Components that need form-level state (like submit buttons or status indicators) yield `form` separately:

```ts
const SubmitButton = () =>
  Effect.gen(function* () {
    const form = yield* MyForm.form;

    return yield* $.button(
      { type: "submit", disabled: form.isSubmitting },
      $.of(Readable.map(form.isSubmitting, (s) => (s ? "Saving..." : "Save"))),
    );
  });

const FormStatus = () =>
  Effect.gen(function* () {
    const form = yield* MyForm.form;

    return yield* when(form.isDirty, {
      onTrue: () => $.span($.of("You have unsaved changes")),
      onFalse: () => $.span(),
    });
  });
```

### Form State Properties

```ts
const form = yield* MyForm.form;

// Reactive values
form.isValid       // Readable<boolean> — all fields valid
form.isSubmitting  // Readable<boolean> — submit in progress
form.isTouched     // Readable<boolean> — any field touched
form.isDirty       // Readable<boolean> — any field changed
form.errors        // Readable<ParseIssue[]> — form-level errors

// Actions
yield* form.validate();   // Validate all fields, returns boolean
yield* form.reset();      // Reset all fields to initial values
yield* form.submit();     // Validate then call onSubmit handlers

// Get values
const encoded = yield* form.getEncoded();  // Raw form values
const decoded = yield* form.getDecoded();  // Validated values (may fail with ParseError)
```

## Submit Handlers

Submit handlers can be defined at two levels — form-level and instance-level. Both run on successful validation; form-level runs first.

```ts
// Form-level handler (runs first — good for analytics, logging)
const MyForm = Form.make(
  { name: Field.make(Schema.String) },
  {
    onSubmit: (ctx) =>
      Effect.sync(() => {
        analytics.track("form_submit", ctx.decoded);
      }),
  },
);

// Instance-level handler (runs second — specific to this usage)
MyForm.provide(
  {
    defaults: { name: "" },
    onSubmit: (ctx) =>
      Effect.gen(function* () {
        yield* saveToServer(ctx.decoded);
      }),
  },
  children,
);
```

The submit context provides:

```ts
interface SubmitContext<Encoded, Decoded> {
  encoded: Encoded;           // Raw form values
  decoded: Decoded;           // Validated/transformed values
  form: {
    isValid: boolean;
    errors: ParseIssue[];
    touched: ReadonlySet<string>;
    dirty: ReadonlySet<string>;
  };
}
```

## Progressive Enhancement

When using `@stax-ui/platform`, forms can work without JavaScript via the `action` property:

```ts
MyForm.provide(
  {
    defaults: { name: "" },
    action: actions.create,   // from RouteDataContext
    onSubmit: (ctx) =>
      Effect.gen(function* () {
        yield* Effect.tryPromise(() =>
          fetch(actions.create, {
            method: "POST",
            body: JSON.stringify(ctx.encoded),
          }),
        );
      }),
  },
  $.form(
    { class: "my-form" },
    // ...fields
  ),
);
```

When `action` is provided, the rendered `<form>` gets `action` and `method="POST"` attributes. Without JS, the form submits natively to the server. With JS, `onSubmit` intercepts and handles it client-side.

## Complex Validation

Use Effect Schema's full power for validation:

```ts
const RegistrationForm = Form.make({
  username: Field.make(
    Schema.String.pipe(
      Schema.minLength(3, { message: () => "Too short" }),
      Schema.maxLength(20, { message: () => "Too long" }),
      Schema.pattern(/^[a-z0-9_]+$/, {
        message: () => "Only lowercase letters, numbers, and underscores",
      }),
    ),
  ),
  email: Field.make(
    Schema.String.pipe(Schema.nonEmptyString({ message: () => "Required" })),
  ),
  age: Field.make(
    Schema.Number.pipe(
      Schema.int({ message: () => "Must be a whole number" }),
      Schema.greaterThanOrEqualTo(18, { message: () => "Must be 18+" }),
    ),
  ),
});
```

## API Reference

### Field

| Function | Description |
|---|---|
| `Field.make(schema, config?)` | Create a leaf field from an Effect Schema |
| `Field.make(fields, config?)` | Create a struct field from nested fields |
| `Field.Array(element, config?)` | Create an array field |
| `Field.Map(keySchema, element, config?)` | Create a map field |
| `isField(value)` | Type guard for any field |
| `isLeafField(value)` | Type guard for leaf fields |
| `isStructField(value)` | Type guard for struct fields |
| `isArrayField(value)` | Type guard for array fields |
| `isMapField(value)` | Type guard for map fields |

### FieldConfig

```ts
interface FieldConfig {
  validateOn?: "blur" | "change" | "submit";
  debounce?: number;  // ms, for "change" validation
}
```

### Form

| API | Description |
|---|---|
| `Form.make(fields, config?)` | Create a form definition |
| `form.provide(config, children)` | Create live state, provide context to children |
| `form.fields.<name>` | Effect that yields the named field's state |
| `form.form` | Effect that yields form-level state |
| `isForm(value)` | Type guard |

### FormConfig

```ts
interface FormConfig {
  validateOn?: "blur" | "change" | "submit";
  debounce?: number;
  onSubmit?: (ctx: SubmitContext) => Effect<void>;
}
```

### ProvideConfig

```ts
interface ProvideConfig {
  defaults: Encoded;                               // Initial values for all fields
  onSubmit?: (ctx: SubmitContext) => Effect<void>;  // Instance-level submit handler
  action?: string;                                 // Native form action for progressive enhancement
}
```

## Acknowledgments

The schema-first, context-based architecture of this package was inspired by [effect-form](https://github.com/lucas-barake/effect-form).
