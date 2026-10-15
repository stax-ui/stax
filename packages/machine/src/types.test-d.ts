/**
 * Type-level validation. This file is compiled but never runs — its
 * purpose is to prove (via `@ts-expect-error` comments) that the
 * types in `./index` narrow correctly at use-site.
 *
 * If TypeScript accepts something that shouldn't compile OR rejects
 * something that should, the corresponding `@ts-expect-error` line
 * flips its verdict and the file stops type-checking. That failure
 * is the test.
 *
 * No runtime assertions; no vitest wiring. `pnpm typecheck` is the
 * runner.
 */

import { Effect } from "effect";

import {
  Machine,
  type AnyTransition,
  type HandlerMap,
  type MachineSelf,
  type Spec,
  type Transition,
} from "./index.js";

// =============================================================================
// Domain types used by the fixtures below
// =============================================================================

interface User {
  readonly id: string;
  readonly name: string;
}

// -----------------------------------------------------------------------------
// A representative singleton machine's generic parameters.
// -----------------------------------------------------------------------------

interface SessionStates {
  booting: {};
  signedOut: {};
  signedIn: { user: User };
  expired: {};
}

interface SessionEvents {
  AUTHENTICATED: { user: User };
  SIGN_OUT: {};
  EXPIRE: {};
}

interface SessionContext {
  user: User | null;
  lastLoginAt: number | null;
}

interface SessionOutput {
  user: User | null;
}

declare const self: MachineSelf<SessionStates, SessionEvents, SessionContext>;

// =============================================================================
// `self.transition(...)` — the core typing story
// =============================================================================

// State names narrow correctly. The returned Effect's success value
// is the Transition.
const _t1: Effect.Effect<Transition<"signedIn", { user: User }>> =
  self.transition("signedIn", { user: { id: "u1", name: "n" } });

// Empty payloads can be omitted.
const _t2: Effect.Effect<Transition<"signedOut", {}>> =
  self.transition("signedOut");

// Empty payload can also be passed explicitly as `{}`.
const _t3: Effect.Effect<Transition<"booting", {}>> = self.transition(
  "booting",
  {},
);

// @ts-expect-error - "bogus" isn't a valid state name.
self.transition("bogus");

// @ts-expect-error - "signedIn" requires a { user: User } payload.
self.transition("signedIn");

// @ts-expect-error - payload shape wrong: `user` should be User, not number.
self.transition("signedIn", { user: 123 });

// @ts-expect-error - payload has extra key `bogus`.
self.transition("signedIn", { user: { id: "u1", name: "n" }, bogus: 1 });

// =============================================================================
// `self.assign(...)` — Context typing
// =============================================================================

// self.assign has an empty error channel — self is only handed to
// runtime-invoked callbacks (state fns, handlers, `ready`), which
// only run post-init. The MachineUninitialized case is
// unreachable by construction, so it doesn't pollute the type.

// Partial patch — subset of context fields.
const _a1: Effect.Effect<void> = self.assign({ user: null });
const _a2: Effect.Effect<void> = self.assign({ lastLoginAt: 123 });
const _a3: Effect.Effect<void> = self.assign({
  user: { id: "u1", name: "n" },
  lastLoginAt: Date.now(),
});

// Computed patch form — same error channel.
const _a4: Effect.Effect<void> = self.assign((ctx) => ({
  lastLoginAt: (ctx.lastLoginAt ?? 0) + 1,
}));

// @ts-expect-error - `bogus` isn't a Context field.
self.assign({ bogus: 1 });

// @ts-expect-error - wrong value type for `user`.
self.assign({ user: 123 });

// `self.context` is a plain getter with the full Context type.
const _ctxUser: User | null = self.context.user;
const _ctxLast: number | null = self.context.lastLoginAt;

// @ts-expect-error - context has no `bogus` field.
self.context.bogus;

// =============================================================================
// `self.dispatch` / `self.dispatchOrFail` — Event typing
// =============================================================================

// dispatch has an empty error channel by default — runtime bugs
// (`MalformedSpec`) die as defects, and no `UserE` is declared on
// this fixture's machine, so there's nothing on the typed channel.
const _d1: Effect.Effect<void> = self.dispatch("AUTHENTICATED", {
  user: { id: "u1", name: "n" },
});
const _d2: Effect.Effect<void> = self.dispatch("SIGN_OUT");
const _d3: Effect.Effect<void> = self.dispatch("EXPIRE");

// @ts-expect-error - "BOGUS_EVENT" isn't a declared event.
self.dispatch("BOGUS_EVENT");

// @ts-expect-error - AUTHENTICATED requires a payload.
self.dispatch("AUTHENTICATED");

// @ts-expect-error - payload shape wrong.
self.dispatch("AUTHENTICATED", { user: "not a user" });

// dispatchOrFail adds UnhandledEvent on top of the dispatch failures.
const _f1: Effect.Effect<void, import("./index.js").UnhandledEvent> =
  self.dispatchOrFail("SIGN_OUT");

// =============================================================================
// `self.transitionAwait(...)` — the async-transition primitive
// =============================================================================

declare const register: (go: () => void) => () => void;

const _ta1: Effect.Effect<Transition<"signedOut", {}>> = self.transitionAwait(
  register,
  "signedOut",
);

// @ts-expect-error - wrong target state.
self.transitionAwait(register, "bogus");

// @ts-expect-error - payload required for signedIn.
self.transitionAwait(register, "signedIn");

// =============================================================================
// `HandlerMap` and `StateFn` shapes
// =============================================================================

// A handler for AUTHENTICATED must accept { user: User } and return
// Effect<Transition | void>.
const _hm: HandlerMap<SessionStates, SessionEvents> = {
  AUTHENTICATED: ({ user }) =>
    Effect.gen(function* () {
      yield* self.assign({ user, lastLoginAt: Date.now() });
      return yield* self.transition("signedIn", { user });
    }),
  SIGN_OUT: () =>
    Effect.gen(function* () {
      yield* self.assign({ user: null });
      return yield* self.transition("signedOut");
    }),
};

const _hmBad: HandlerMap<SessionStates, SessionEvents> = {
  // @ts-expect-error - "BOGUS_EVENT" isn't a declared event.
  BOGUS_EVENT: () => Effect.void,
};

// Handler payload is typed against the event map — the destructure
// only compiles if `payload` really is `{ user: User }`. One-line
// case where the handler just transitions: no wrapper needed since
// `self.transition` returns an Effect directly.
const _hmPayload: HandlerMap<SessionStates, SessionEvents> = {
  AUTHENTICATED: (payload) => {
    const _user: User = payload.user;
    void _user;
    return self.transition("signedOut");
  },
};
void _hmPayload;

// =============================================================================
// `AnyTransition` — the discriminated union
// =============================================================================

// Every state name appears in the union. `self.transition` returns
// `Effect<AnyTransition>` under this discriminated union, so each
// variant's Effect flows into the union through the Effect's A.
const _anyT1: Effect.Effect<AnyTransition<SessionStates>> =
  self.transition("booting");
const _anyT2: Effect.Effect<AnyTransition<SessionStates>> = self.transition(
  "signedIn",
  { user: { id: "u1", name: "n" } },
);
const _anyT3: Effect.Effect<AnyTransition<SessionStates>> =
  self.transition("expired");
const _anyT4: Effect.Effect<AnyTransition<SessionStates>> =
  self.transition("signedOut");

// =============================================================================
// `Spec` — the full spec object shape
// =============================================================================

const _spec: Spec<SessionStates, SessionEvents, SessionContext, SessionOutput> =
  {
    initial: "booting",
    context: { user: null, lastLoginAt: null },
    output: (ctx) => ({ user: ctx.user }),
    // Global `on` handlers take (self, payload) — no state fn to
    // close over here.
    on: {
      SIGN_OUT: (self) =>
        Effect.gen(function* () {
          yield* self.assign({ user: null });
          return yield* self.transition("signedOut");
        }),
    },
    states: {
      // State fns take (self, payload). Handlers inside a state fn
      // close over the state fn's self — they only receive payload.
      booting: (self) => self.transition("signedOut"),
      signedOut: (self, _) =>
        Effect.succeed({
          AUTHENTICATED: ({ user }: { user: User }) =>
            Effect.gen(function* () {
              yield* self.assign({ user });
              return yield* self.transition("signedIn", { user });
            }),
        }),
      signedIn: (self, { user: _u }) =>
        Effect.succeed({
          EXPIRE: () =>
            Effect.gen(function* () {
              yield* self.assign({ user: null });
              return yield* self.transition("expired");
            }),
        }),
      expired: (self, _) =>
        Effect.succeed({
          AUTHENTICATED: ({ user }: { user: User }) =>
            Effect.gen(function* () {
              yield* self.assign({ user });
              return yield* self.transition("signedIn", { user });
            }),
        }),
    },
  };

// initial must be a valid state name.
const _initialCheck: keyof SessionStates & string = _spec.initial;

const _specBadInitial: Spec<
  SessionStates,
  SessionEvents,
  SessionContext,
  SessionOutput
> = {
  ..._spec,
  // @ts-expect-error - initial state must be from the state map.
  initial: "bogus",
};

const _specBadContext: Spec<
  SessionStates,
  SessionEvents,
  SessionContext,
  SessionOutput
> = {
  ..._spec,
  // @ts-expect-error - context must match Context type.
  context: { user: null, lastLoginAt: null, bogus: 1 },
};

// =============================================================================
// `Machine.Service` and `Machine.Factory` class factories — smoke check
// =============================================================================

// Class declaration compiles (uses double-paren pattern like Effect.Service).
class SessionMachine extends Machine.Service<
  SessionMachine,
  SessionStates,
  SessionEvents,
  SessionContext,
  SessionOutput,
  never
>()("SessionMachine") {}

// The class itself is usable as a service reference.
void SessionMachine;

// Factory class factory declaration compiles.
interface ConversationInputs {
  initialConversationId?: string;
}
interface ConversationStates {
  idle: {};
  pending: {};
}
interface ConversationEvents {
  SEND: { message: string };
}
interface ConversationContext {
  conversationId: string | null;
}
interface ConversationOutput {
  conversationId: string | null;
}

class ConversationMachine extends Machine.Factory<
  ConversationMachine,
  ConversationStates,
  ConversationEvents,
  ConversationInputs,
  ConversationContext,
  ConversationOutput,
  never
>()("ConversationMachine") {}

void ConversationMachine;

// Cross-machine sanity: a factory's spawn args match its `Inputs` generic.
declare const factory: import("./index.js").MachineFactory<
  ConversationStates,
  ConversationEvents,
  ConversationInputs,
  ConversationOutput
>;
void factory.spawn({ initialConversationId: "c1" });
void factory.spawn({});
// @ts-expect-error - bogus field on Inputs.
factory.spawn({ bogus: 1 });

// =============================================================================
// Sanity — Machine namespace has the expected members
// =============================================================================

const _ns1: typeof Machine.Service = Machine.Service;
const _ns2: typeof Machine.Factory = Machine.Factory;
const _ns3: typeof Machine.serviceLayer = Machine.serviceLayer;
const _ns4: typeof Machine.factoryLayer = Machine.factoryLayer;
void _ns1;
void _ns2;
void _ns3;
void _ns4;

// Silence unused-locals warnings for the assignments above that
// exist purely to constrain types.
void _t1;
void _t2;
void _t3;
void _a1;
void _a2;
void _a3;
void _a4;
void _ctxUser;
void _ctxLast;
void _d1;
void _d2;
void _d3;
void _f1;
void _ta1;
void _hm;
void _hmBad;
void _anyT1;
void _anyT2;
void _anyT3;
void _anyT4;
void _spec;
void _initialCheck;
void _specBadInitial;
void _specBadContext;
