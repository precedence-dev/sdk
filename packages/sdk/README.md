# @precedence/sdk

The runtime half of Precedence — what makes `@precedence/instrument`'s
`emit: "runtime"` mode work. **Framework-agnostic, zero dependencies, ~1 KB.**
Call `installPrecedence` once at your app root:

```ts
// wherever runs once at startup — root layout, _app, main.ts, a side-effect import
import { installPrecedence } from "@precedence/sdk";
import { track } from "@/lib/analytics"; // your actual analytics client

installPrecedence({ track });
```

## What it does

`@precedence/instrument --emit runtime` injects `globalThis.__pm?.("<anchor id>",
{ ...in-scope props })` at each branch and stamps `data-pm-el="<anchor id>"` on
each synthetic anchor (a link / bare `<button>` with no handler to splice a call
into). It bakes in **no** event name and **no** static props — everything else is
this package's job. `installPrecedence`:

- fetches the plan (once, from `planUrl`), or takes one you pass as `plan`;
- sets `globalThis.__pm`, mapping an anchor id → the plan's event name — so a
  rename / retarget is a plan edit, not a rebuild;
- shapes each payload: `pm_id` first (the anchor id — the key `--explain` and
  your dashboard use to trace a value back to its fire site), then the props the
  plan currently selects (narrowing that list needs no rebuild — the injected
  call passes a superset), then the anchor's `outcome` / `placement`
  discriminator from the plan;
- installs one capture-phase `click` listener for the synthetic anchors, which
  carry only a `data-pm-el` stamp and no injected call.

## Options

| | default | |
| --- | --- | --- |
| `track` | (required) | your analytics call: `(name, props) => void` |
| `planUrl` | `/precedence-plan.json` | where to fetch the plan; assumed to sit in your `public/` dir |
| `plan` | — | an already-fetched plan, to skip the fetch |

`installFromPlan(plan, track)` is the fetch-free core if you want to load the
plan yourself.

## The picker hook

When the page is opened with `?precedence=pick&at=<url>` (by `@precedence/wizard`),
the picker agent is loaded from that URL — a ~15-line hook, no overlay code here,
`at` must be localhost. That's how "click real elements in your running app"
works; the agent + UI live in [`@precedence/viewer`](../viewer). It never runs in
a normal page (the param is never there).

`installPrecedence` runs it; `installPrecedence({ picker: false })` opts out. If
you want the picker but not runtime mode, call **`precedencePicker()`** on its
own — e.g. from a Next `instrumentation-client.ts` (what `@precedence/wizard`
writes for you).

## Notes

- **Not React-specific.** A dev-time picker used to ship here as a React
  component (`PrecedenceDevtools`); it's gone. The hook above is the
  framework-neutral replacement.
- `pm_id`, `data-pm-el`, `__pm` are the wire-protocol identifiers shared with
  `@precedence/instrument`'s injected calls.
- `installPrecedence` fetches once at startup — until it resolves, `__pm` is
  unset and events are dark. Pass `plan` yourself to make it synchronous.

## Structure

```
src/
├── runtime.ts   installPrecedence / installFromPlan / the click listener — unit-tested
└── index.ts     the public entry
```
