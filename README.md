# precedence — client-side packages

The two Precedence packages that run in (or target) the browser. Both are
public, MIT, and depend on nothing proprietary — they only need the *shape* of
`catalog.pcs` / the plan, not the analyzer.

| package | what it is |
| --- | --- |
| [`packages/sdk`](packages/sdk) — `@precedence/sdk` | the runtime for `@precedence/instrument`'s `emit: "runtime"` mode. `installPrecedence` maps an anchor id → event, shapes the payload, catches synthetic-anchor clicks. Framework-agnostic, zero deps. |
| [`packages/viewer`](packages/viewer) — `@precedence/viewer` | the outcome picker: a self-contained `index.html` that renders a `catalog.pcs` and exports a plan. Plus `precedence-view`, which bakes a shareable static copy. |

```sh
npm install
npm test        # builds + tests both packages
```

The analysis engine (`@precedence/cli`) lives in
[precedence-dev/core](https://github.com/precedence-dev/core); the plan applier
in [precedence-dev/instrument](https://github.com/precedence-dev/instrument); the
one-command flow in [precedence-dev/wizard](https://github.com/precedence-dev/wizard).
