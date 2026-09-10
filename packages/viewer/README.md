# @precedence-dev/viewer

Serves Precedence's **live picker** and hands back the event plan.

The picker (`browser/agent.js`) is a vanilla overlay that
[`@precedence-dev/sdk`](https://github.com/precedence-dev/sdk/tree/main/packages/sdk)
injects into your running dev build when you open it with
`?precedence=pick&at=<this server>`. You hover and click real elements; it
resolves each click to a catalog entry via the `data-precedence-id` stamp
([`@precedence-dev/cli/stamp-loader`](https://github.com/precedence-dev/core/tree/main/packages/cli)),
shows that element's outcomes — including outcomes that live one level out, when
the handler forwards to a prop — and POSTs the picked ones back as a plan
[`@precedence-dev/instrument`](https://github.com/precedence-dev/instrument) consumes.
The overlay runs in a shadow root, so no style collisions.

[`@precedence-dev/wizard`](https://github.com/precedence-dev/wizard) drives this
end to end. You normally don't call this package directly.

## API

```ts
import { servePlan } from "@precedence-dev/viewer";

const plan = await servePlan(catalog, {
  plan: existingPlan,              // seed GET /plan so the picker merges, not replaces
  open: false,                    // the caller opens the app itself
  onListen: (url) => open(`${appUrl}/?precedence=pick&at=${encodeURIComponent(url)}`),
});
```

`servePlan` starts a one-shot HTTP server on `127.0.0.1` and resolves with the
plan object the picker POSTs to `/plan` (rejects on timeout, default 30 min).

Routes, all `Access-Control-Allow-Origin: *` (the agent runs on the dev
server's origin):

| route | |
| --- | --- |
| `GET /agent.js` | the in-page picker |
| `GET /catalog` | the catalog JSON |
| `GET /plan` | the existing plan (from `opts.plan`), or `{ events: [] }` |
| `POST /plan` | the export — resolves `servePlan()` |

`openInBrowser(target)` is also exported (best-effort `open` / `xdg-open` / `start`).

## What it is not

There is no standalone page. Reviewing a catalog without running the app was a
separate mode; it's gone — the picker works against the live DOM, and that's the
point.
