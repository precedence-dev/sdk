# @precedence/viewer

A browser for Precedence's `catalog.pcs` (produced by
[`@precedence/cli`](https://github.com/precedence-dev/core/tree/main/packages/cli)):
review the tracking attach points a repo exposes without running the app, and
pick the ones to track.

`index.html` is a self-contained page. Drop a `catalog.pcs` onto it (plain JSON;
a `.json` file works too), or open it with `?src=<url>`. It shows every element /
action / outcome-branch tree, lets you pick nodes to define events (properties to
send, group binding, per-anchor status, `outcome` / `placement` discriminators
for "one event, N branches"), and exports the plan
[`@precedence/instrument`](https://github.com/precedence-dev/instrument) consumes:
`{ events: [{ name, properties, anchors: [{ id, fingerprint, staticProps? }] }] }`.

This is the outcome picker. A live in-app picker — click the real running UI — is
future work.

## Use

**In the browser:** open `index.html`, drop a `catalog.pcs` on it (or `?src=<url>`).

**Baked (share / CI):** `precedence-view` bakes a catalog into a copy of the page.

```
precedence-view catalog.pcs --open
precedence-view ./build              # first catalog.pcs in a dir
precedence --dir src --stdout | precedence-view -
```

| flag | meaning |
| --- | --- |
| `--out <file>` | HTML output (default `./viz/index.html`) |
| `--open` | open it when written |
| `--stdout` | write the HTML to stdout |

## What it does not do

- No parsing: it renders exactly what the analyzer emitted.
- No live DOM — it works off `catalog.pcs`, not a running app. That's the point:
  review on a PR or in CI without booting anything.

Selections live in `localStorage`, keyed by the catalog's `commit`.
