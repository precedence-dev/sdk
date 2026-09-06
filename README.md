# @precedence/sdk

Two things, imported into your own app rather than injected into it from
outside:

- **`installPrecedence`** — the runtime half. Makes `@precedence/instrument`'s
  `emit: "runtime"` mode work: it injects `globalThis.__pm?.("<anchor id>", {
  ...props })` at each anchor with no event name or static props baked in;
  this fetches the plan and maps an anchor id back to its event, so
  renaming/retargeting/adding a static prop is a plan edit, not a rebuild.
- **`PrecedenceDevtools`** — the dev-only outcome picker panel.

```tsx
// wherever you call installPrecedence once, e.g. your root layout or _app
import { installPrecedence } from "@precedence/sdk";
import { track } from "@/lib/analytics"; // your actual analytics client

installPrecedence({ track });
```

```tsx
// app/layout.tsx (Next.js App Router), or any root component
import { PrecedenceDevtools } from "@precedence/sdk/devtools";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html><body>
      {children}
      {process.env.NODE_ENV !== "production" && <PrecedenceDevtools />}
    </body></html>
  );
}
```

Split into two entry points (`.` and `./devtools`) so installing the runtime
alone doesn't pull in React — `react`/`react-dom` are optional peer
dependencies, only needed if you import `./devtools`.

## The picker

Alt+Shift+P opens `<PrecedenceDevtools />` manually at any time.
`@precedence/wizard` also opens it automatically: it launches your dev
server with `?precedence=pick` appended, which the component checks for on
mount and opens itself, click-picking already armed. Click an element,
choose which of its outcomes to track, name them, "Save & continue".

Resolving a click to a catalog entry uses React's dev-mode fiber
(`_debugSource` — file + line, set by the classic Babel/React dev
transform); this is the "fiber" rung of the resolution order
`@precedence/cli`'s own README documents (stamp loader -> fiber -> a
file-scoped fallback). The honest limit: `_debugSource` isn't present on
every build — notably not Next.js's default SWC compiler or React 19. The
panel says so plainly on a failed resolution rather than guessing; the
stamp loader (wired into your bundler config) is the actual fix for those
builds, and this package doesn't do that wiring for you yet.

## Props (`PrecedenceDevtools`)

| | default | |
| --- | --- | --- |
| `catalogUrl` | `/precedence-catalog.pcs` | fetched lazily, only once you open the panel |
| `planEndpoint` | `http://127.0.0.1:51820/plan` | where the finished plan is POSTed — `@precedence/wizard`'s local server listens here |

## Options (`installPrecedence`)

| | default | |
| --- | --- | --- |
| `planUrl` | `/precedence-plan.json` | fetched once, on install |
| `plan` | — | pass an already-fetched plan instead, skips the fetch |
| `track` | (required) | your actual analytics call: `(name, props) => void` |

## Structure

```
src/
├── catalog.ts    the public subset of @precedence/cli's catalog.pcs shape this reads (no dependency on @precedence/cli itself)
├── resolve.ts    fiberSource / findElement / shouldAutoActivate — unit-tested
├── devtools.tsx  <PrecedenceDevtools /> — the panel (exports/devtools)
├── runtime.ts    installPrecedence / installFromPlan — unit-tested
└── index.ts      the main entry: runtime only, no React
```

Tree-shaken out of production the way every dev-only component is: gate the
`./devtools` import/render behind `process.env.NODE_ENV !== "production"` in
your own layout, as in the example above — this package can't know your
bundler's env-replacement setup, so it doesn't attempt that for you.
