# @precedence-dev/viewer

A browser for Precedence's `catalog.pcs` (produced by
[`@precedence-dev/cli`](https://github.com/precedence-dev/core/tree/main/packages/cli)):
review the tracking attach points a repo exposes without running the app, and
pick the ones to track.

`index.html` is a self-contained page. Drop a `catalog.pcs` onto it (plain JSON;
a `.json` file works too), or open it with `?src=<url>`. It shows every element /
action / outcome-branch tree, lets you pick nodes to define events (properties to
send, group binding, per-anchor status, `outcome` / `placement` discriminators
for "one event, N branches"), and exports the plan
[`@precedence-dev/instrument`](https://github.com/precedence-dev/instrument) consumes:
`{ events: [{ name, properties, anchors: [{ id, fingerprint, staticProps? }] }] }`.

## Live picker (`browser/agent.js`)

`servePlan` also serves `agent.js` — a vanilla overlay `@precedence-dev/sdk` injects
into a running dev build (opened with `?precedence=pick&at=<this server>`). You
hover/click real elements; it resolves each click to a catalog entry via the
`data-precedence-id` stamp ([`@precedence-dev/cli/stamp-loader`](https://github.com/precedence-dev/core/tree/main/packages/cli)),
shows that element's outcome branches, and POSTs the picked ones back as a plan.
`@precedence-dev/wizard` drives this. The overlay runs in a shadow root — no style
collisions.

## Use

**In the browser:** open `index.html`, drop a `catalog.pcs` on it (or `?src=<url>`).

**Served (`--serve`):** run a local server, open the picker, and write the plan
the moment you click "send to wizard" — no file to move. This is what
`@precedence-dev/wizard` uses.

```
precedence-view catalog.pcs --serve                 # writes ./.precedence/plan.json
precedence-view catalog.pcs --serve --out plan.json
```

**Baked (share / CI):** `precedence-view` writes a self-contained copy with the
catalog pre-loaded.

```
precedence-view catalog.pcs --open
precedence-view ./build              # first catalog.pcs in a dir
precedence --dir src --stdout | precedence-view -
```

| flag | meaning |
| --- | --- |
| `--serve` | serve the picker on `127.0.0.1`, write the exported plan |
| `--out <file>` | bake: HTML path (default `./viz/index.html`); serve: plan path (`-` for stdout) |
| `--open` | bake: open it when written (serve always opens) |
| `--stdout` | bake: write the HTML to stdout |

`servePlan(catalog)` and `renderHtml(catalog)` are also exported for use from Node.

## What it does not do

- No parsing: it renders exactly what the analyzer emitted.
- No live DOM — it works off `catalog.pcs`, not a running app. That's the point:
  review on a PR or in CI without booting anything.

Selections live in `localStorage`, keyed by the catalog's `commit`.
