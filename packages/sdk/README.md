# @precedence-dev/sdk

The **client half of Precedence**. `@precedence-dev/instrument` bakes a complete
`precedence.track("event", { psc_id, ...props })` call at every tracked site
(`psc_id` is a short hash of the anchor); this package collects those (plus
hand-written `precedence.track` / `identify`), buffers, batches, and delivers
them to one destination — with an optional live plan overlay.
**Framework-agnostic, zero dependencies.**

```ts
// wherever runs once at startup — root layout, _app, main.ts, a side-effect import
import { installPrecedence } from "@precedence-dev/sdk";

installPrecedence({ endpoint: "https://collect.example.com/e" });

// optional: load the plan as a live overlay (rename / disable / retune events
// without a rebuild — the next instrument run re-bakes the source to match)
installPrecedence({
  endpoint: "https://collect.example.com/e",  // URL | (batch) => void | omit
  planUrl: "/precedence-plan.json",            // or plan: <object>
});
```

## What it does

Every event — a baked `precedence.track(...)` call, a synthetic-anchor click, or
a hand-written `precedence.track` / `identify`:

1. is shaped into the **canonical envelope** below;
2. buffers in memory;
3. **flushes on 20 events, 10 s, or page hide** (`navigator.sendBeacon`, falling
   back to `fetch(keepalive)`) — one `POST { batch: [...] }` per flush.

**Fire-and-forget: a failed flush drops that batch. No retry queue, no durable
storage, one destination.** Everything deferred (retry, plan `destinations`,
vendor adapters, consent, sessions) is additive over this shape — see
[`docs/sdk-collection.md`](../../../docs/sdk-collection.md).

### The plan overlay

With `planUrl` / `plan`, `installPrecedence` loads the plan and `precedence.track`
matches each baked call by `psc_id`:

| the loaded plan… | …applied to the baked call, no rebuild |
| --- | --- |
| renamed the event | emit the new name |
| narrowed the property list | drop the props it no longer lists |
| defines an `outcome` / `placement` discriminator | add it (it's never baked) |
| dropped the event | suppress it |
| — matches what's baked | passthrough |

Overlaid events get `properties.psc_v` (the plan version) so a warehouse row is
self-contained. A hand-written `precedence.track` call with no `psc_id` is never
touched by the overlay. With no plan loaded, the baked calls emit exactly as
`precedence-instrument` wrote them.

### `endpoint`

| value | behaviour |
| --- | --- |
| a **URL** string | `POST { batch: [event, …] }`, `keepalive`; `sendBeacon` on page hide |
| a **function** `(batch) => void` | you get the batch array — route it to your own client |
| **omitted** | `console.debug` each event (dev default) |

### Manual events

Same pipeline, same envelope:

```ts
import { precedence } from "@precedence-dev/sdk";

precedence.track("signup_completed", { plan: "pro" });
precedence.identify("u_123", { email: "…" });   // traits optional
precedence.reset();                              // logout — clears both ids
precedence.flush();                              // force-send now
```

`identify` stores `userId`, sends one `{ type: "identify", userId, anonymousId,
traits? }` event, and from then on **every event carries both `anonymousId` and
`userId`** — so a warehouse can `JOIN` the earlier anonymous-only rows to the
known user on the shared `anonymousId`.

## Canonical envelope

A minimal subset of the Segment message — it grows toward the full shape
(`messageId`, `campaign`, `library`, …) in later versions without breaking this:

```jsonc
{
  "type": "track",                 // track | identify
  "event": "checkout_completed",   // track only
  "properties": {                  // track only
    "amount": 42,                  //   the customer's props (as baked, or as the overlay reshaped them)
    "psc_id": "p_1qzcbxk",         //   reserved — the anchor hash, keys the overlay, traces to the fire site
    "psc_v": 7                     //   reserved — plan version, present only on overlaid events
  },
  "traits": { "email": "…" },      // identify only
  "anonymousId": "a1b2…",          // always — localStorage["pmid"] or crypto.randomUUID()
  "userId": "u_123",               // after identify()
  "timestamp": "2026-09-09T00:00:00.000Z",
  "context": { "page": { "url": "…", "path": "/checkout", "referrer": "…", "title": "…" } }
}
```

`psc_id` / `psc_v` sit in `properties` (not `context`) so they ride through every
adapter — Amplitude's `event_properties`, Mixpanel's flattened bag — without
per-vendor code.

## Options

| | default | |
| --- | --- | --- |
| `endpoint` | `console.debug` | URL string, `(batch) => void`, or omitted |
| `planUrl` | — | load the plan overlay from here (e.g. `/precedence-plan.json` in `public/`) |
| `plan` | — | an already-loaded plan overlay, instead of `planUrl` |
| `picker` | `true` | set `false` to ignore `?precedence=pick` even in dev |

## The picker hook

When the page is opened with `?precedence=pick&at=<url>` (by
`@precedence-dev/wizard`), the picker agent is loaded from that URL — a ~15-line
hook, no overlay UI code here, `at` must be localhost. The agent + UI live in
[`@precedence-dev/viewer`](../viewer). It never runs in a normal page.

`installPrecedence` runs it; `installPrecedence({ picker: false })` opts out. To
run only the picker (no collection), call **`precedencePicker()`** on its own —
e.g. from a Next `instrumentation-client.ts` (what `@precedence-dev/wizard` writes).

## Notes

- **Not React-specific.** No component to mount.
- `psc_id` is a cyrb53 hash — `@precedence-dev/instrument` bakes it and this
  package has a byte-for-byte copy of the hash (`pscId` in `plan.ts`); a test
  vector in both suites keeps them in sync.
- `data-precedence-id` (the synthetic-anchor stamp) stays the readable structural
  id — it's a same-origin DOM hook, never sent anywhere.
- With a `planUrl`, `installPrecedence` fetches once at startup; baked calls made
  before it resolves emit un-overlaid. Pass `plan` yourself to avoid the fetch.

## Structure

```
src/
├── plan.ts       plan types · pscId hash · indexByPscId · the overlay reshape
├── pipeline.ts   canonical envelope · buffer · flush · identity · precedence.* · the overlay
├── runtime.ts    installPrecedence · precedencePicker
└── index.ts      the public entry
```
