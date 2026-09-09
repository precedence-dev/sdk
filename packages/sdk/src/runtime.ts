/**
 * The runtime half of @precedence-dev/sdk: makes @precedence-dev/instrument's
 * `emit: "runtime"` mode work.
 *
 * instrument's runtime mode injects `globalThis.__pm?.("<anchor id>", { ...in-
 * scope props })` at each branch and stamps `data-precedence-id="<anchor id>"` on each
 * synthetic anchor (a link / bare button with no handler to splice into). It
 * bakes in no event name and no static props — everything else is left to this
 * module, so a rename / retarget / discriminator change / prop narrowing is a
 * plan edit with no rebuild. Specifically, `installPrecedence`:
 *
 *   1. sets `globalThis.__pm`, which maps an anchor id → the plan's event name
 *      and shapes the payload (see `shape` below);
 *   2. installs one capture-phase document click listener for the synthetic
 *      anchors instrument only stamped — their click has to be caught here.
 *
 * `pm_id`, `data-precedence-id` and `__pm` are the wire-protocol identifiers shared with
 * @precedence-dev/instrument's injected calls.
 */

/** every emitted event carries the anchor id under this key, so a value seen in
 *  the dashboard traces back to the exact fire site — matches instrument's
 *  `PM_ID_KEY` (direct mode bakes it in; runtime mode adds it here). */
export const PM_ID_KEY = "pm_id";

export interface PlanAnchor {
  id: string;
  /** the `outcome` / `placement` discriminator, layered onto every payload */
  staticProps?: Record<string, string>;
}
export interface PlanEvent { name: string; properties: string[]; anchors: PlanAnchor[]; }
export interface RuntimePlan { events: PlanEvent[]; }

export interface InstallOpts {
  /** where to fetch the plan from; default assumes it's in your public/ dir */
  planUrl?: string;
  /** an already-fetched plan, if you don't want this to fetch it itself */
  plan?: RuntimePlan;
  /** your analytics call, e.g. (name, props) => client.track(name, props). May
   *  return void, a Promise, or a thenable; failures are isolated from the app. */
  track: (name: string, props: Record<string, unknown>) => unknown;
  /** set false to ignore `?precedence=pick` even in dev (default: honour it) */
  picker?: boolean;
}

declare global {
  // eslint-disable-next-line no-var
  var __pm: ((id: string, props?: Record<string, unknown>) => void) | undefined;
}

interface Hit { event: PlanEvent; anchor: PlanAnchor; }

function indexById(plan: RuntimePlan): Map<string, Hit> {
  const byId = new Map<string, Hit>();
  for (const event of plan.events) for (const anchor of event.anchors) byId.set(anchor.id, { event, anchor });
  return byId;
}

/** the payload instrument's `runtimeCall` leaves to the runtime: `pm_id` first,
 *  then the props the plan currently selects (narrowing the list is a plan edit,
 *  no rebuild — the injected call passes a superset), then the anchor's static /
 *  discriminator props on top. */
function shape(hit: Hit, props: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { [PM_ID_KEY]: hit.anchor.id };
  for (const p of hit.event.properties) if (p in props) out[p] = props[p];
  return Object.assign(out, hit.anchor.staticProps ?? {});
}

/** synthetic-anchor props come off DOM attributes at click time; a couple of
 *  plan names map to non-obvious attributes. Mirrors instrument's delegated
 *  listener and the catalog's `autoProps`. */
const ATTR: Record<string, string> = { label: "aria-label", track_id: "data-track" };
function domProps(el: Element, properties: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const p of properties) {
    const v = el.getAttribute(ATTR[p] ?? p);
    if (v != null) out[p] = v;
  }
  return out;
}

let detachClick: (() => void) | undefined;

/** Wires up globalThis.__pm (and the synthetic-anchor click listener) from an
 *  already-loaded plan — no fetch, directly testable. Re-callable: a later call
 *  replaces the previous wiring, so a plan hot-reload doesn't stack listeners. */
export function installFromPlan(plan: RuntimePlan, track: InstallOpts["track"]): void {
  const byId = indexById(plan);

  const emit = (id: string, props: Record<string, unknown> = {}): void => {
    const hit = byId.get(id);
    if (!hit) return;
    // Runtime mode must preserve direct mode's fire-and-forget contract: an
    // unavailable analytics SDK must never break checkout, navigation, etc.
    try {
      void Promise.resolve(track(hit.event.name, shape(hit, props))).catch(() => {});
    } catch {
      // Deliberately ignored: analytics is observational, never control flow.
    }
  };

  globalThis.__pm = (id, props) => emit(id, props);

  detachClick?.();
  detachClick = undefined;
  if (typeof document !== "undefined") {
    const onClick = (e: Event): void => {
      const target = e.target as Element | null;
      const el = target && typeof target.closest === "function" ? target.closest("[data-precedence-id]") : null;
      const id = el?.getAttribute("data-precedence-id");
      if (!el || !id) return;
      const hit = byId.get(id);
      if (hit) emit(id, domProps(el, hit.event.properties));
    };
    document.addEventListener("click", onClick, true);
    detachClick = () => document.removeEventListener("click", onClick, true);
  }
}

export async function installPrecedence(opts: InstallOpts): Promise<void> {
  if (opts.picker !== false && precedencePicker()) return; // dev picker mode — skip the normal runtime wiring
  const plan = opts.plan ?? (await fetch(opts.planUrl ?? "/precedence-plan.json").then((r) => r.json()));
  installFromPlan(plan, opts.track);
}

/** `?precedence=pick&at=<url>` (from `@precedence-dev/wizard`) loads the picker agent
 *  into this page — the only overlay code is served from `at`, which must be
 *  localhost. Returns true when it activated. Call this on its own (e.g. from a
 *  Next `instrumentation-client.ts`) if you want the picker but not runtime mode. */
export function precedencePicker(): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") return false;
  const q = new URLSearchParams(window.location.search);
  if (q.get("precedence") !== "pick") return false;
  let at: URL;
  try { at = new URL(q.get("at") || ""); } catch { return false; }
  if (!/^(localhost|127\.0\.0\.1|\[::1\])$/.test(at.hostname)) return false;
  const s = document.createElement("script");
  s.src = new URL("/agent.js", at.origin).href;
  document.head.appendChild(s);
  return true;
}
