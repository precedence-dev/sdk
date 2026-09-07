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

## Notes

- **Not React-specific.** A dev-time outcome picker used to ship here as a React
  component (`PrecedenceDevtools`); it was removed to keep this package
  framework-neutral. Pick outcomes with the static [`@precedence/viewer`](../viewer)
  (same repo) for now.
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
