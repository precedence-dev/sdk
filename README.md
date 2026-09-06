# @precedence/devtools

A floating devtools panel for picking tracking outcomes — imported into your
own app tree, same pattern as `@tanstack/react-query-devtools`, not a script
injected across a page boundary. `@precedence/wizard` used to solve this with
a bookmarklet; this replaces that.

```tsx
// app/layout.tsx (Next.js App Router), or any root component
import { PrecedenceDevtools } from "@precedence/devtools";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html><body>
      {children}
      {process.env.NODE_ENV !== "production" && <PrecedenceDevtools />}
    </body></html>
  );
}
```

Alt+Shift+P opens the panel manually at any time. `@precedence/wizard` also
opens it automatically: it launches your dev server with `?precedence=pick`
appended, which this component checks for on mount and opens itself,
click-picking already armed — the same idea as Amplitude's Visual Labeling
activating its pre-installed SDK's dormant toolbar when it opens your site,
except without the `postMessage`/window-opener handshake Amplitude needs
(that exists because their trigger comes from a separate hosted dashboard
tab; a local CLI can just open the right URL directly). Click an element,
choose which of its outcomes to track, name them, "Save & continue".

## Why this instead of a bookmarklet

The bookmarklet worked, but every limitation it had was a direct consequence
of running *outside* your app (a different script, a different origin): CORS
for every request, a fiber walk reaching across a page boundary rather than
its own tree, an install step (drag a bookmark, or get silently blocked —
Chrome/Firefox strip `javascript:` URLs pasted into the address bar) just to
get code running on the page at all. A real imported component has none of
that — it's already part of the tree.

**What doesn't change**: `_debugSource` (the file+line React's dev-mode fiber
carries, which is how a click resolves to a catalog entry) is set by the
classic Babel/React dev JSX transform — a build-time property, not something
where this code runs. Next.js's default SWC compiler and React 19 don't set
it, same as before. The panel says so plainly on a failed resolution instead
of guessing; the stamp loader (wired into your bundler config) is the actual
fix for those builds, and this package doesn't do that wiring for you yet.

## Props

| | default | |
| --- | --- | --- |
| `catalogUrl` | `/precedence-catalog.pcs` | fetched lazily, only once you open the panel |
| `planEndpoint` | `http://127.0.0.1:51820/plan` | where the finished plan is POSTed — `@precedence/wizard`'s local server listens here |

## Structure

```
src/
├── catalog.ts   the public subset of @precedence/cli's catalog.pcs shape this reads (no dependency on @precedence/cli itself)
├── resolve.ts   fiberSource / findElement / shouldAutoActivate — unit-tested
└── index.tsx    <PrecedenceDevtools /> — the panel
```

Tree-shaken out of production the way every dev-only devtools component is:
gate the import/render behind `process.env.NODE_ENV !== "production"` in your
own layout, as in the example above — this package can't know your bundler's
env-replacement setup, so it doesn't attempt that for you.
