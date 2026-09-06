/**
 * Resolve a clicked DOM node to a catalog element. Two independent sources,
 * tried in the order @precedence/cli's README documents (stamp loader ->
 * fiber -> a file-scoped fallback — this covers the first two rungs):
 *
 *  - stampSource: the `data-pm-el="file:line"` attribute @precedence/cli's
 *    stamp loader stamps onto interactive JSX at build time (a webpack/
 *    Turbopack loader, wired in by @precedence/wizard) — works regardless of
 *    compiler, including Next.js's default SWC and React 19.
 *  - fiberSource: React's dev-mode fiber (`_debugSource`, or the older
 *    `__source`/`_debugOwner` shapes) — set by the classic Babel/React dev
 *    transform. The honest limit: SWC and React 19 don't set it, and this
 *    returns null rather than guessing when that's the case — which is
 *    exactly why stampSource is tried first.
 */
import type { Catalog, UiElement } from "./catalog";

type Source = { fileName: string; lineNumber: number };

export function stampSource(node: unknown): Source | null {
  const el = node as Element | null;
  const stamped = el && typeof el.closest === "function" ? el.closest("[data-pm-el]") : null;
  const attr = stamped ? stamped.getAttribute("data-pm-el") : null;
  const m = attr ? /^(.+):(\d+)$/.exec(attr) : null;
  return m ? { fileName: m[1], lineNumber: +m[2] } : null;
}

export function fiberSource(node: unknown): Source | null {
  let n = node as (Record<string, unknown> & { parentElement?: unknown }) | null;
  while (n) {
    const key = Object.keys(n).find((k) => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$"));
    if (key) {
      type Fiber = {
        _debugSource?: Source;
        memoizedProps?: { __source?: Source };
        _debugOwner?: { _debugSource?: Source };
        return?: unknown;
      };
      let fiber = n[key] as Fiber | undefined;
      while (fiber) {
        const s = fiber._debugSource || fiber.memoizedProps?.__source || fiber._debugOwner?._debugSource;
        if (s) return s;
        fiber = fiber.return as Fiber | undefined;
      }
    }
    n = (n.parentElement as typeof n) || null;
  }
  return null;
}

/** Both sources in priority order, whichever resolves first. */
export function resolveSource(node: unknown): Source | null {
  return stampSource(node) || fiberSource(node);
}

export function findElement(catalog: Catalog, fileName: string, line: number): UiElement | null {
  const norm = fileName.replace(/\\/g, "/");
  for (const el of catalog.elements) {
    if (norm.slice(-el.file.length) !== el.file) continue;
    if (Math.abs(el.line - line) > 2) continue;
    return el;
  }
  return null;
}

export function flattenBranches<T extends { children: T[] }>(bs: T[], out: T[] = []): T[] {
  for (const b of bs) { out.push(b); flattenBranches(b.children, out); }
  return out;
}

/**
 * The activation handshake: `@precedence/wizard` opens
 * `<your-dev-url>?precedence=pick` directly, and this component checks for
 * that query param on mount to open itself with click-picking already armed
 * — no injected script, no separate install step.
 */
export function shouldAutoActivate(search: string): boolean {
  return new URLSearchParams(search).get("precedence") === "pick";
}

export interface PlanEntry {
  name: string;
  properties: Set<string>;
  allProps: string[];
  fingerprint: { handler: string; conditionKey: string };
}
export interface PlanAnchor { id: string; fingerprint: PlanEntry["fingerprint"]; }
export interface PlanEvent { name: string; properties: string[]; anchors: PlanAnchor[]; }
export interface WirePlan { events: PlanEvent[]; }

/** The panel's in-memory plan -> the wire shape @precedence/instrument consumes. */
export function toWire(plan: Map<string, PlanEntry>): WirePlan {
  return { events: [...plan.entries()].map(([id, e]) => ({ name: e.name, properties: [...e.properties], anchors: [{ id, fingerprint: e.fingerprint }] })) };
}

/** The inverse of toWire, best-effort — an event this component didn't itself
 *  produce (hand-edited, or from a previous run) still round-trips its name
 *  and properties, just without the original candidateProps list to offer. */
export function fromWire(data: Partial<WirePlan>): Map<string, PlanEntry> {
  const plan = new Map<string, PlanEntry>();
  for (const ev of data.events || []) {
    for (const a of ev.anchors || []) {
      plan.set(a.id, { name: ev.name, properties: new Set(ev.properties || []), allProps: ev.properties || [], fingerprint: a.fingerprint });
    }
  }
  return plan;
}
